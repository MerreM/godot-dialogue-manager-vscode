# Godot Dialogue Manager for VS Code

Language support for [Godot Dialogue Manager](https://github.com/nathanhoad/godot_dialogue_manager) `.dialogue` files, so you can write branching dialogue in VS Code with syntax highlighting, navigation and error checking.

```
import "res://dialogue/snippets.dialogue" as snippets

~ start
Nathan: [#happy] Hello, {{player_name}}!
- Tell me more => more
- Some banter please =>< snippets/banter
- I know a secret [if SomeGlobal.knows_secret /] => secret
- Bye
	Nathan: See you around.
	=> END

~ more
if SomeGlobal.visits > 3
	Nathan: You again? [wait=0.5] Fine.
$> SomeGlobal.visits += 1
=> END
```

## Features

### Syntax highlighting

This extension highlights every part of the dialogue syntax:

- cues: `~ start`
- jumps: `=> cue`, `=>< cue`, `=> snippets/cue`, `END`, `END!`
- character names: `Nathan:`
- line prefixes:
  - responses: `- `
  - random lines: `%`, `%2`
  - concurrent lines: `| `
- conditions: `if`, `elif`, `else`, `while`, `match`, `when`
- state changes (mutations): `$>`, `$>>`, and the older `set`/`do`
- file directives: `import "res://…" as name`, `using SomeGlobal`
- `{{interpolation}}` with expression highlighting
- inline tags:
  - tags: `[#happy, #mood=good]`
  - line IDs: `[ID:HELLO]`
  - inline conditions: `[if x]…[else]…[/if]`
  - inline mutations: `[$> do_something()]`
  - random choices: `[[Hi|Hello|Hey]]`
- typing control: `[wait]`, `[speed]`, `[next]`
- BBCode: `[b]`, `[color=red]`, …
- comments: `#`, and translator notes with `##`

### Navigation

- **Outline and breadcrumbs.** Every cue is listed. Use `Ctrl+Shift+O` to jump to a cue in the current file, or `Ctrl+T` to search cues across the workspace.
- **Go to definition** (`F12` / `Ctrl+Click`). Works on jump targets and `import` paths. Jumps into imported files work too (`=> snippets/banter`).
- **Find all references** (`Shift+F12`). Lists every jump to a cue, in every file that imports it.
- **Rename** (`F2`). Renames a cue and updates every jump that points to it, across files.
- **Hover** over a jump to preview the start of the cue it points to.

`res://` paths are resolved relative to the folder containing your `project.godot`.

### Completion

- After `=> ` or `=>< `, it suggests cues in the current file, import names (`snippets/` → that file's cues), `END` and `END!`.
- `Ctrl+Space` at the start of a line suggests character names already used in the file.

Suggestions don't pop up while you type ordinary dialogue text.

### Error checking

Problems are underlined as you type and listed in the Problems panel:

- jumps to cues that don't exist, locally or in an imported file
- duplicate cue names
- invalid cue names: names that contain spaces or symbols, begin with a number, or use the reserved `END`
- jumps using an import name that isn't defined
- duplicate import names
- `import` paths that point to a missing file

### Snippets

Snippets cover cues, responses, `if`/`elif`/`else`, `match`, `while`, mutations, imports and the inline tags. Type a prefix such as `if`, `match`, `-=>` or `[wait` and choose the snippet.

### Editor defaults

Dialogue Manager requires tab indentation, so `.dialogue` files use tabs and word wrap by default. You can override this in your settings under `[godot-dialogue]`.

## Installation

The extension isn't on the Marketplace yet. To install it from source:

```sh
git clone <this repository>
cd godot-dialogue-manager-vscode
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension godot-dialogue-manager-vscode-0.0.1.vsix
```

To install it from the editor instead, open the Extensions view, click `…`, choose **Install from VSIX…** and pick the `.vsix` file.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `godotDialogueManager.diagnostics.enabled` | `true` | Report problems in `.dialogue` files. |

## Limitations

- The error checks are a quick line-based pass, not the addon's compiler. Godot will still catch mistakes inside expressions and anything else these checks don't cover.
- `uid://` import paths aren't resolved.
- Computed jumps (`=> {{expression}}`) aren't resolved.

## Development

```sh
npm install
npm run compile      # or: npm run watch
npm run test:unit    # parser tests in plain Node
npm test             # full extension tests inside VS Code
```

Press `F5` in VS Code to launch an Extension Development Host. It opens `test-fixtures/project`, a small Godot project with sample dialogue to try things on.

Project layout:

| Path | Contents |
| --- | --- |
| `src/parser.ts` | Line-based `.dialogue` parser and checks (no VS Code dependency) |
| `src/workspace.ts` | `res://` resolution and cross-file lookups |
| `src/features.ts` | Outline, definition, references, rename, hover, completion, diagnostics |
| `syntaxes/dialogue.tmLanguage.json` | TextMate grammar for highlighting |
| `snippets/dialogue.json` | Snippets |

## License

MIT. See the `LICENSE` file.

This is an unofficial companion to [Godot Dialogue Manager](https://github.com/nathanhoad/godot_dialogue_manager) by Nathan Hoad.
