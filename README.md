# Godot Dialogue Manager for VS Code

Language support for [Godot Dialogue Manager](https://github.com/nathanhoad/godot_dialogue_manager) `.dialogue` files, so you can write dialogue in VS Code as comfortably as in Godot's built-in dialogue editor.

## Features

- **Syntax highlighting.** Covers cues (`~ start`), jumps (`=>`, `=><`, `END`, `END!`), character names, responses (`-`), random lines (`%`, `%2`), concurrent lines (`|`), conditions (`if`/`elif`/`else`/`while`/`match`/`when`), mutations (`$>`, `$>>`, plus the older `set`/`do`), `import` and `using`, tags (`[#happy]`), line IDs (`[ID:...]`), `{{interpolation}}`, inline conditions (`[if x]...[else]...[/if]`), inline mutations (`[$> ...]`), `[[random|options]]`, `[wait]`/`[speed]`/`[next]`, and BBCode.
- **Outline and breadcrumbs.** Every cue is a symbol, so *Go to Symbol* (`Ctrl+Shift+O`) and *Go to Symbol in Workspace* (`Ctrl+T`) both work.
- **Go to definition.** Works on jump targets (`=> some_cue`, `=> snippets/banter`) and on `import` paths. `res://` paths resolve relative to the folder containing `project.godot`.
- **Find all references and rename (`F2`).** Work on cues, across every file that imports them.
- **Completion.**
  - Typing after `=> ` suggests cues, import prefixes and `END`.
  - `Ctrl+Space` at the start of a line suggests character names already used in the file.
- **Hover.** Hovering a jump target previews the start of that cue.
- **Diagnostics.** Reports:
  - unknown cues (local and imported)
  - duplicate or invalid cue names
  - unknown import names
  - import files that don't exist
- **Snippets.** Covers cues, responses, conditions, `match`, `while`, mutations, imports and the inline tags.

Dialogue Manager requires tab indentation, so the extension sets `.dialogue` files to use tabs by default.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `godotDialogueManager.diagnostics.enabled` | `true` | Report problems in `.dialogue` files. |

## Limitations

- The diagnostics are a quick, line-based check, not the addon's full compiler. Godot will still catch expression errors and anything else this check doesn't model.
- `uid://` import paths and dynamic jumps (`=> {{expression}}`) aren't resolved.

## Development

```sh
npm install
npm run compile      # or: npm run watch
npm run test:unit    # parser tests in plain Node
npm test             # full extension tests inside VS Code
```

Press `F5` to launch an Extension Development Host. `test-fixtures/project` is a small Godot project you can open there to try things out.
