import * as vscode from 'vscode';
import {
	Cue,
	ParsedDialogue,
	Span,
	VALID_CUE_REGEX,
	cueSectionEnd,
	isPositionIn,
	lintDialogue,
	parseDialogue,
} from './parser';
import { DialogueWorkspace, LANGUAGE_ID } from './workspace';

export const SELECTOR: vscode.DocumentSelector = [
	{ language: LANGUAGE_ID, scheme: 'file' },
	{ language: LANGUAGE_ID, scheme: 'untitled' },
];

function toRange(span: Span): vscode.Range {
	return new vscode.Range(span.line, span.start, span.line, span.end);
}

/** What's under the cursor, as far as navigation is concerned. */
type Target =
	| { kind: 'cue'; cue: Cue }
	| { kind: 'jump'; jump: ParsedDialogue['jumps'][number]; onPrefix: boolean }
	| { kind: 'import'; imp: ParsedDialogue['imports'][number]; onPrefix: boolean };

function symbolAt(parsed: ParsedDialogue, pos: vscode.Position): Target | undefined {
	for (const cue of parsed.cues) {
		if (isPositionIn(cue, pos.line, pos.character)) {
			return { kind: 'cue', cue };
		}
	}
	for (const jump of parsed.jumps) {
		if (isPositionIn(jump, pos.line, pos.character)) {
			return { kind: 'jump', jump, onPrefix: !!jump.prefix && pos.character < jump.cueStart };
		}
	}
	for (const imp of parsed.imports) {
		if (isPositionIn(imp, pos.line, pos.character)) {
			return { kind: 'import', imp, onPrefix: false };
		}
		if (imp.line === pos.line && pos.character >= imp.prefixStart && pos.character <= imp.prefixEnd) {
			return { kind: 'import', imp, onPrefix: true };
		}
	}
	return undefined;
}

export class DialogueSymbolProvider implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		const parsed = parseDialogue(document.getText());
		const lines = document.getText().split(/\r?\n/);
		const symbols: vscode.DocumentSymbol[] = [];

		for (const imp of parsed.imports) {
			const line = document.lineAt(imp.line).range;
			symbols.push(new vscode.DocumentSymbol(imp.prefix, imp.path, vscode.SymbolKind.Module, line, toRange({ line: imp.line, start: imp.prefixStart, end: imp.prefixEnd })));
		}
		for (const using of parsed.usings) {
			symbols.push(new vscode.DocumentSymbol(using.state, 'using', vscode.SymbolKind.Namespace, document.lineAt(using.line).range, toRange(using)));
		}
		parsed.cues.forEach((cue, i) => {
			const end = cueSectionEnd(parsed, i, lines);
			const full = new vscode.Range(cue.line, 0, end, lines[end]?.length ?? 0);
			symbols.push(new vscode.DocumentSymbol(cue.name, '', vscode.SymbolKind.Function, full, toRange(cue)));
		});
		return symbols;
	}
}

export class DialogueWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
		const results: vscode.SymbolInformation[] = [];
		const q = query.toLowerCase();
		for (const uri of await this.ws.findDialogueFiles()) {
			if (token.isCancellationRequested) {
				break;
			}
			const parsed = await this.ws.getParsed(uri);
			for (const cue of parsed?.cues ?? []) {
				if (!q || cue.name.toLowerCase().includes(q)) {
					const container = vscode.workspace.asRelativePath(uri);
					results.push(new vscode.SymbolInformation(cue.name, vscode.SymbolKind.Function, container, new vscode.Location(uri, toRange(cue))));
				}
			}
		}
		return results;
	}
}

export class DialogueDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
		const parsed = parseDialogue(document.getText());
		const sym = symbolAt(parsed, position);
		if (!sym) {
			return undefined;
		}

		if (sym.kind === 'import') {
			const uri = await this.ws.resolveImport(document.uri, sym.imp);
			if (!uri) {
				return undefined;
			}
			const origin = sym.onPrefix ? { line: sym.imp.line, start: sym.imp.prefixStart, end: sym.imp.prefixEnd } : sym.imp;
			return [{ originSelectionRange: toRange(origin), targetUri: uri, targetRange: new vscode.Range(0, 0, 0, 0) }];
		}

		if (sym.kind === 'jump') {
			if (sym.onPrefix) {
				const imp = parsed.imports.find((i) => i.prefix === sym.jump.prefix);
				return imp ? new vscode.Location(document.uri, toRange({ line: imp.line, start: imp.prefixStart, end: imp.prefixEnd })) : undefined;
			}
			const resolved = await this.ws.resolveJump(document.uri, parsed, sym.jump);
			if (!resolved?.cue) {
				return undefined;
			}
			const targetParsed = await this.ws.getParsed(resolved.uri);
			const lines = await this.ws.getLines(resolved.uri);
			const index = targetParsed?.cues.findIndex((c) => c.name === resolved.name) ?? -1;
			const end = targetParsed && index >= 0 ? cueSectionEnd(targetParsed, index, lines) : resolved.cue.line;
			return [{
				originSelectionRange: toRange({ line: sym.jump.line, start: sym.jump.cueStart, end: sym.jump.end }),
				targetUri: resolved.uri,
				targetRange: new vscode.Range(resolved.cue.line, 0, end, lines[end]?.length ?? 0),
				targetSelectionRange: toRange(resolved.cue),
			}];
		}

		return new vscode.Location(document.uri, toRange(sym.cue));
	}
}

export class DialogueReferenceProvider implements vscode.ReferenceProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): Promise<vscode.Location[]> {
		const target = await resolveCueTarget(this.ws, document, position);
		if (!target) {
			return [];
		}
		const locations: vscode.Location[] = [];
		if (context.includeDeclaration && target.cue) {
			locations.push(new vscode.Location(target.uri, toRange(target.cue)));
		}
		for (const { uri, jump } of await this.ws.findJumpsTo(target.uri, target.name)) {
			locations.push(new vscode.Location(uri, toRange({ line: jump.line, start: jump.cueStart, end: jump.end })));
		}
		return locations;
	}
}

export class DialogueRenameProvider implements vscode.RenameProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async prepareRename(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Range | { range: vscode.Range; placeholder: string }> {
		const parsed = parseDialogue(document.getText());
		const sym = symbolAt(parsed, position);
		if (sym?.kind === 'cue') {
			return { range: toRange(sym.cue), placeholder: sym.cue.name };
		}
		if (sym?.kind === 'jump' && !sym.jump.isEnd && !sym.onPrefix) {
			const resolved = await this.ws.resolveJump(document.uri, parsed, sym.jump);
			if (!resolved?.cue) {
				throw new Error(`Can't find cue "${sym.jump.cue}".`);
			}
			return { range: toRange({ line: sym.jump.line, start: sym.jump.cueStart, end: sym.jump.end }), placeholder: sym.jump.cue };
		}
		throw new Error('You can only rename cues.');
	}

	async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): Promise<vscode.WorkspaceEdit | undefined> {
		if (!VALID_CUE_REGEX.test(newName) || /^\d/.test(newName) || newName === 'END') {
			throw new Error(`"${newName}" is not a valid cue name.`);
		}
		const target = await resolveCueTarget(this.ws, document, position);
		if (!target?.cue) {
			return undefined;
		}
		const targetParsed = await this.ws.getParsed(target.uri);
		if (targetParsed?.cues.some((c) => c.name === newName)) {
			throw new Error(`A cue named "${newName}" already exists.`);
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(target.uri, toRange(target.cue), newName);
		for (const { uri, jump } of await this.ws.findJumpsTo(target.uri, target.name)) {
			edit.replace(uri, toRange({ line: jump.line, start: jump.cueStart, end: jump.end }), newName);
		}
		return edit;
	}
}

/** The cue being referred to at `position`, whether that's its definition or a jump to it. */
async function resolveCueTarget(ws: DialogueWorkspace, document: vscode.TextDocument, position: vscode.Position) {
	const parsed = parseDialogue(document.getText());
	const sym = symbolAt(parsed, position);
	if (sym?.kind === 'cue') {
		return { uri: document.uri, name: sym.cue.name, cue: sym.cue as Cue | undefined };
	}
	if (sym?.kind === 'jump' && !sym.onPrefix) {
		return ws.resolveJump(document.uri, parsed, sym.jump);
	}
	return undefined;
}

export class DialogueHoverProvider implements vscode.HoverProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
		const parsed = parseDialogue(document.getText());
		const sym = symbolAt(parsed, position);
		if (sym?.kind === 'jump') {
			const range = toRange(sym.jump);
			if (sym.jump.isEnd) {
				const text = sym.jump.cue === 'END!'
					? '**END!** — end the conversation, ignoring any pending jump-and-return (`=><`) jumps.'
					: '**END** — end the current flow. If this flow was reached with `=><`, return to where it jumped from.';
				return new vscode.Hover(new vscode.MarkdownString(text), range);
			}
			const resolved = await this.ws.resolveJump(document.uri, parsed, sym.jump);
			if (!resolved?.cue) {
				return undefined;
			}
			const lines = await this.ws.getLines(resolved.uri);
			const preview = lines.slice(resolved.cue.line, resolved.cue.line + 8);
			const nextCue = preview.findIndex((l, i) => i > 0 && /^\s*~\s/.test(l));
			const md = new vscode.MarkdownString();
			if (resolved.uri.toString() !== document.uri.toString()) {
				md.appendMarkdown(`*${vscode.workspace.asRelativePath(resolved.uri)}*\n\n`);
			}
			md.appendCodeblock((nextCue > 0 ? preview.slice(0, nextCue) : preview).join('\n').trimEnd(), LANGUAGE_ID);
			return new vscode.Hover(md, range);
		}
		return undefined;
	}
}

export class DialogueCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private readonly ws: DialogueWorkspace) {}

	async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | undefined> {
		const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

		const jump = /(?:^|\s)=><?\s+([\p{L}\p{N}_\p{Emoji_Presentation}/!]*)$/u.exec(linePrefix);
		if (jump) {
			return this.jumpCompletions(document, position, jump[1]);
		}

		// A character name at the start of a dialogue line. Only on explicit request
		// (Ctrl+Space), otherwise every space typed in prose would pop up suggestions.
		if (context.triggerKind !== vscode.CompletionTriggerKind.Invoke) {
			return undefined;
		}
		const speaker = /^\s*(?:-\s+|\|\s+|%[\d.]*\s+)?([\p{L}\p{N}_ ]*)$/u.exec(linePrefix);
		if (speaker && speaker[1].length > 0 && !/^\s*(if|elif|else|while|match|when|using|import|set|do)\b/.test(linePrefix)) {
			const parsed = parseDialogue(document.getText());
			const names = new Set(parsed.characters.filter((c) => c.line !== position.line).map((c) => c.name));
			const range = new vscode.Range(position.line, position.character - speaker[1].length, position.line, position.character);
			return [...names].map((name) => {
				const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.User);
				item.insertText = `${name}: `;
				item.range = range;
				item.detail = 'Character';
				return item;
			});
		}
		return undefined;
	}

	private async jumpCompletions(document: vscode.TextDocument, position: vscode.Position, typed: string): Promise<vscode.CompletionItem[]> {
		const parsed = parseDialogue(document.getText());
		const range = new vscode.Range(position.line, position.character - typed.length, position.line, position.character);
		const items: vscode.CompletionItem[] = [];

		const slash = typed.indexOf('/');
		if (slash >= 0) {
			const prefix = typed.slice(0, slash);
			const imp = parsed.imports.find((i) => i.prefix === prefix);
			const uri = imp && (await this.ws.resolveImport(document.uri, imp));
			const imported = uri && (await this.ws.getParsed(uri));
			for (const cue of imported ? imported.cues : []) {
				const item = new vscode.CompletionItem(`${prefix}/${cue.name}`, vscode.CompletionItemKind.Function);
				item.range = range;
				item.detail = imp!.path;
				items.push(item);
			}
			return items;
		}

		for (const cue of parsed.cues) {
			const item = new vscode.CompletionItem(cue.name, vscode.CompletionItemKind.Function);
			item.range = range;
			item.detail = `Cue (line ${cue.line + 1})`;
			item.sortText = `0${cue.name}`;
			items.push(item);
		}
		for (const imp of parsed.imports) {
			const item = new vscode.CompletionItem(`${imp.prefix}/`, vscode.CompletionItemKind.Module);
			item.range = range;
			item.detail = imp.path;
			item.sortText = `1${imp.prefix}`;
			item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest cues' };
			items.push(item);
		}
		const end = new vscode.CompletionItem('END', vscode.CompletionItemKind.Keyword);
		end.range = range;
		end.detail = 'End the current flow';
		end.sortText = '2END';
		const endBang = new vscode.CompletionItem('END!', vscode.CompletionItemKind.Keyword);
		endBang.range = range;
		endBang.detail = 'End the conversation, ignoring jump-and-return';
		endBang.sortText = '2END!';
		items.push(end, endBang);
		return items;
	}
}

export class DialogueDiagnostics implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(private readonly ws: DialogueWorkspace) {}

	schedule(document: vscode.TextDocument, delay = 300): void {
		if (document.languageId !== LANGUAGE_ID) {
			return;
		}
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => {
			this.timers.delete(key);
			void this.update(document);
		}, delay));
	}

	refreshAll(): void {
		for (const doc of vscode.workspace.textDocuments) {
			this.schedule(doc);
		}
	}

	clear(document: vscode.TextDocument): void {
		clearTimeout(this.timers.get(document.uri.toString()));
		this.collection.delete(document.uri);
	}

	async update(document: vscode.TextDocument): Promise<void> {
		if (document.isClosed || !vscode.workspace.getConfiguration('godotDialogueManager', document).get<boolean>('diagnostics.enabled', true)) {
			this.collection.delete(document.uri);
			return;
		}
		const version = document.version;
		const parsed = parseDialogue(document.getText());
		const diagnostics: vscode.Diagnostic[] = lintDialogue(parsed).map((p) => {
			const d = new vscode.Diagnostic(toRange(p), p.message, vscode.DiagnosticSeverity.Error);
			d.code = p.code;
			d.source = 'Dialogue Manager';
			return d;
		});

		// Cross-file checks.
		const imported = new Map<string, ParsedDialogue | undefined>();
		for (const imp of parsed.imports) {
			if (document.uri.scheme === 'untitled') {
				break;
			}
			const uri = await this.ws.resolveImport(document.uri, imp);
			if (!uri) {
				continue;
			}
			const importedParsed = await this.ws.getParsed(uri);
			imported.set(imp.prefix, importedParsed);
			if (!importedParsed) {
				const d = new vscode.Diagnostic(toRange(imp), `Can't find "${imp.path}".`, vscode.DiagnosticSeverity.Error);
				d.code = 'missing-import';
				d.source = 'Dialogue Manager';
				diagnostics.push(d);
			}
		}
		for (const jump of parsed.jumps) {
			if (!jump.prefix || jump.isEnd) {
				continue;
			}
			const importedParsed = imported.get(jump.prefix);
			if (importedParsed && jump.cue !== 'END' && !importedParsed.cues.some((c) => c.name === jump.cue)) {
				const range = toRange({ line: jump.line, start: jump.cueStart, end: jump.end });
				const d = new vscode.Diagnostic(range, `Unknown cue "${jump.cue}" in "${jump.prefix}".`, vscode.DiagnosticSeverity.Error);
				d.code = 'unknown-cue';
				d.source = 'Dialogue Manager';
				diagnostics.push(d);
			}
		}

		if (document.version === version && !document.isClosed) {
			this.collection.set(document.uri, diagnostics);
		}
	}

	dispose(): void {
		this.timers.forEach(clearTimeout);
		this.collection.dispose();
	}
}
