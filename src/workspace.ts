import * as vscode from 'vscode';
import { Cue, Import, Jump, ParsedDialogue, parseDialogue } from './parser';

export const LANGUAGE_ID = 'godot-dialogue';
export const DIALOGUE_GLOB = '**/*.dialogue';

/**
 * Resolves files and parses dialogue across the workspace. Open documents take
 * priority over what is on disk so that unsaved edits are reflected everywhere.
 */
export class DialogueWorkspace {
	private readonly diskCache = new Map<string, { mtime: number; parsed: ParsedDialogue }>();
	private readonly projectRootCache = new Map<string, vscode.Uri | null>();

	/** Parse the given document (or file) using the editor's buffer if it is open. */
	async getParsed(uri: vscode.Uri): Promise<ParsedDialogue | undefined> {
		const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
		if (open) {
			return parseDialogue(open.getText());
		}
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			const key = uri.toString();
			const cached = this.diskCache.get(key);
			if (cached && cached.mtime === stat.mtime) {
				return cached.parsed;
			}
			const bytes = await vscode.workspace.fs.readFile(uri);
			const parsed = parseDialogue(new TextDecoder().decode(bytes));
			this.diskCache.set(key, { mtime: stat.mtime, parsed });
			return parsed;
		} catch {
			return undefined;
		}
	}

	async getLines(uri: vscode.Uri): Promise<string[]> {
		const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
		if (open) {
			return open.getText().split(/\r?\n/);
		}
		try {
			return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/);
		} catch {
			return [];
		}
	}

	/** Finds the folder containing `project.godot` above the given file. That folder is `res://`. */
	async findProjectRoot(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		let dir = vscode.Uri.joinPath(uri, '..');
		const visited: string[] = [];
		for (;;) {
			const key = dir.toString();
			if (this.projectRootCache.has(key)) {
				const cached = this.projectRootCache.get(key) ?? undefined;
				visited.forEach((v) => this.projectRootCache.set(v, cached ?? null));
				return cached;
			}
			visited.push(key);
			if (await exists(vscode.Uri.joinPath(dir, 'project.godot'))) {
				visited.forEach((v) => this.projectRootCache.set(v, dir));
				return dir;
			}
			const parent = vscode.Uri.joinPath(dir, '..');
			if (parent.path === dir.path) {
				break;
			}
			dir = parent;
		}
		// No Godot project found: fall back to the workspace folder.
		const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri;
		visited.forEach((v) => this.projectRootCache.set(v, folder ?? null));
		return folder;
	}

	/** Turns a path written in a dialogue file (usually `res://...`) into a URI. */
	async resolvePath(from: vscode.Uri, path: string): Promise<vscode.Uri | undefined> {
		if (path.startsWith('res://')) {
			const root = await this.findProjectRoot(from);
			return root ? vscode.Uri.joinPath(root, path.slice('res://'.length)) : undefined;
		}
		if (path.startsWith('uid://') || /^[a-z]+:\/\//i.test(path)) {
			// UIDs are stored in Godot's cache, which we can't read reliably.
			return undefined;
		}
		if (path.startsWith('/')) {
			const root = await this.findProjectRoot(from);
			return root ? vscode.Uri.joinPath(root, path) : undefined;
		}
		return vscode.Uri.joinPath(from, '..', path);
	}

	/** Converts a file URI to its `res://` path, if it's inside a Godot project. */
	async toResPath(uri: vscode.Uri): Promise<string | undefined> {
		const root = await this.findProjectRoot(uri);
		if (!root || !uri.path.startsWith(root.path + '/')) {
			return undefined;
		}
		return 'res://' + uri.path.slice(root.path.length + 1);
	}

	async resolveImport(from: vscode.Uri, imp: Import): Promise<vscode.Uri | undefined> {
		return this.resolvePath(from, imp.path);
	}

	/** Finds which file and cue a jump points at. */
	async resolveJump(from: vscode.Uri, parsed: ParsedDialogue, jump: Jump): Promise<ResolvedCue | undefined> {
		if (jump.isEnd) {
			return undefined;
		}
		let uri = from;
		let targetParsed: ParsedDialogue | undefined = parsed;
		if (jump.prefix) {
			const imp = parsed.imports.find((i) => i.prefix === jump.prefix);
			if (!imp) {
				return undefined;
			}
			const resolved = await this.resolveImport(from, imp);
			if (!resolved) {
				return undefined;
			}
			uri = resolved;
			targetParsed = await this.getParsed(uri);
		}
		const cue = targetParsed?.cues.find((c) => c.name === jump.cue);
		return { uri, name: jump.cue, cue };
	}

	async findDialogueFiles(): Promise<vscode.Uri[]> {
		const found = await vscode.workspace.findFiles(DIALOGUE_GLOB, '{**/node_modules/**,**/.godot/**}');
		// Include open, untitled or out-of-workspace dialogue documents too.
		const seen = new Set(found.map((u) => u.toString()));
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.languageId === LANGUAGE_ID && !seen.has(doc.uri.toString())) {
				found.push(doc.uri);
				seen.add(doc.uri.toString());
			}
		}
		return found;
	}

	/** All jumps anywhere in the workspace that point at `cueName` in `target`. */
	async findJumpsTo(target: vscode.Uri, cueName: string): Promise<{ uri: vscode.Uri; jump: Jump }[]> {
		const results: { uri: vscode.Uri; jump: Jump }[] = [];
		const targetKey = target.toString();
		for (const uri of await this.findDialogueFiles()) {
			const parsed = await this.getParsed(uri);
			if (!parsed) {
				continue;
			}
			const sameFile = uri.toString() === targetKey;
			// Work out which import prefixes in this file point at the target file.
			const prefixes = new Set<string>();
			for (const imp of parsed.imports) {
				const resolved = await this.resolveImport(uri, imp);
				if (resolved?.toString() === targetKey) {
					prefixes.add(imp.prefix);
				}
			}
			if (!sameFile && prefixes.size === 0) {
				continue;
			}
			for (const jump of parsed.jumps) {
				if (jump.isEnd || jump.cue !== cueName) {
					continue;
				}
				if (jump.prefix ? prefixes.has(jump.prefix) : sameFile) {
					results.push({ uri, jump });
				}
			}
		}
		return results;
	}

	invalidate(uri: vscode.Uri): void {
		this.diskCache.delete(uri.toString());
		if (uri.path.endsWith('/project.godot')) {
			this.projectRootCache.clear();
		}
	}
}

export interface ResolvedCue {
	uri: vscode.Uri;
	name: string;
	/** Undefined when the file exists (or not) but has no such cue. */
	cue?: Cue;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
