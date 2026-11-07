import * as vscode from 'vscode';
import {
	DialogueCompletionProvider,
	DialogueDefinitionProvider,
	DialogueDiagnostics,
	DialogueHoverProvider,
	DialogueReferenceProvider,
	DialogueRenameProvider,
	DialogueSymbolProvider,
	DialogueWorkspaceSymbolProvider,
	SELECTOR,
} from './features';
import { DIALOGUE_GLOB, DialogueWorkspace } from './workspace';

export function activate(context: vscode.ExtensionContext) {
	const ws = new DialogueWorkspace();
	const diagnostics = new DialogueDiagnostics(ws);

	context.subscriptions.push(
		diagnostics,
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, new DialogueSymbolProvider(), { label: 'Dialogue' }),
		vscode.languages.registerWorkspaceSymbolProvider(new DialogueWorkspaceSymbolProvider(ws)),
		vscode.languages.registerDefinitionProvider(SELECTOR, new DialogueDefinitionProvider(ws)),
		vscode.languages.registerReferenceProvider(SELECTOR, new DialogueReferenceProvider(ws)),
		vscode.languages.registerRenameProvider(SELECTOR, new DialogueRenameProvider(ws)),
		vscode.languages.registerHoverProvider(SELECTOR, new DialogueHoverProvider(ws)),
		vscode.languages.registerCompletionItemProvider(SELECTOR, new DialogueCompletionProvider(ws), ' ', '/'),

		vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.schedule(doc, 0)),
		vscode.workspace.onDidChangeTextDocument((e) => {
			diagnostics.schedule(e.document);
			// Other open files may import this one.
			if (e.document.languageId === 'godot-dialogue') {
				for (const doc of vscode.workspace.textDocuments) {
					if (doc !== e.document) {
						diagnostics.schedule(doc, 600);
					}
				}
			}
		}),
		vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('godotDialogueManager')) {
				diagnostics.refreshAll();
			}
		}),
	);

	const watcher = vscode.workspace.createFileSystemWatcher(`{${DIALOGUE_GLOB},**/project.godot}`);
	const onFileChange = (uri: vscode.Uri) => {
		ws.invalidate(uri);
		diagnostics.refreshAll();
	};
	context.subscriptions.push(watcher, watcher.onDidCreate(onFileChange), watcher.onDidChange(onFileChange), watcher.onDidDelete(onFileChange));

	diagnostics.refreshAll();
}

export function deactivate() {}
