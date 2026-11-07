import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const fixtures = path.resolve(__dirname, '../../../test-fixtures/project/dialogue');
const mainUri = vscode.Uri.file(path.join(fixtures, 'main.dialogue'));
const snippetsUri = vscode.Uri.file(path.join(fixtures, 'snippets.dialogue'));

async function open(): Promise<vscode.TextDocument> {
	const doc = await vscode.workspace.openTextDocument(mainUri);
	await vscode.window.showTextDocument(doc);
	return doc;
}

function positionOf(doc: vscode.TextDocument, needle: string, offset = 0): vscode.Position {
	const index = doc.getText().indexOf(needle);
	assert.ok(index >= 0, `"${needle}" not found`);
	return doc.positionAt(index + offset);
}

suite('Godot Dialogue Manager extension', () => {
	test('registers the language for .dialogue files', async () => {
		const doc = await open();
		assert.strictEqual(doc.languageId, 'godot-dialogue');
	});

	test('outline lists imports and cues', async () => {
		const doc = await open();
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
		assert.deepStrictEqual(symbols.map((s) => s.name), ['snippets', 'SomeGlobal', 'start', 'more', 'secret']);
	});

	test('go to definition on a local jump', async () => {
		const doc = await open();
		const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
			'vscode.executeDefinitionProvider', doc.uri, positionOf(doc, '=> more', 4));
		assert.strictEqual(locations.length, 1);
		const loc = locations[0] as vscode.LocationLink;
		assert.strictEqual(loc.targetUri.fsPath, mainUri.fsPath);
		assert.strictEqual(loc.targetSelectionRange?.start.line, positionOf(doc, '~ more').line);
	});

	test('go to definition on an imported jump resolves res:// paths', async () => {
		const doc = await open();
		const locations = await vscode.commands.executeCommand<vscode.LocationLink[]>(
			'vscode.executeDefinitionProvider', doc.uri, positionOf(doc, 'snippets/banter', 10));
		assert.strictEqual(locations.length, 1);
		assert.strictEqual(locations[0].targetUri.fsPath, snippetsUri.fsPath);
		assert.strictEqual(locations[0].targetSelectionRange?.start.line, 0);
	});

	test('find references across files', async () => {
		await open();
		const snippets = await vscode.workspace.openTextDocument(snippetsUri);
		const refs = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider', snippets.uri, new vscode.Position(0, 3));
		assert.deepStrictEqual(refs.map((r) => path.basename(r.uri.fsPath)).sort(), ['main.dialogue', 'snippets.dialogue']);
	});

	test('rename updates cue and jumps', async () => {
		const doc = await open();
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
			'vscode.executeDocumentRenameProvider', doc.uri, positionOf(doc, '~ secret', 3), 'hidden');
		const changes = edit.get(doc.uri);
		assert.strictEqual(changes.length, 2);
		assert.ok(changes.every((c) => c.newText === 'hidden'));
	});

	test('completes cue names after =>', async () => {
		const doc = await open();
		const pos = positionOf(doc, '=> more', 3);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, pos);
		const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
		for (const expected of ['start', 'more', 'secret', 'snippets/', 'END', 'END!']) {
			assert.ok(labels.includes(expected), `missing completion ${expected}`);
		}
	});

	test('reports no problems for the valid fixture, and flags unknown cues', async () => {
		const doc = await open();
		await waitFor(() => vscode.languages.getDiagnostics(doc.uri).length === 0);

		const untitled = await vscode.workspace.openTextDocument({ language: 'godot-dialogue', content: '~ start\n=> nowhere\n' });
		await waitFor(() => vscode.languages.getDiagnostics(untitled.uri).length === 1);
		assert.match(vscode.languages.getDiagnostics(untitled.uri)[0].message, /Unknown cue "nowhere"/);
	});
});

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeout) {
			assert.fail('Timed out waiting for condition');
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}
