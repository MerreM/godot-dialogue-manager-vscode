/**
 * A lightweight, line-based parser for Godot Dialogue Manager `.dialogue` files.
 *
 * It does not try to be a full compiler: it only extracts the structure that
 * editor features need (cues, jumps, imports, characters). It has no dependency
 * on the `vscode` module so it can be unit tested in plain Node.
 *
 * All positions are zero-based; `start`/`end` are character offsets on `line`.
 */

/** Characters allowed in a cue name (mirrors VALID_CUE_REGEX in the addon's compiler). */
const CUE_CHAR = String.raw`[\p{L}\p{N}_\p{Emoji_Presentation}]`;

export const VALID_CUE_REGEX = new RegExp(`^${CUE_CHAR}+$`, 'u');
const JUMP_TARGET_REGEX = new RegExp(`^(?:(${CUE_CHAR}+)/)?(${CUE_CHAR}+!?)$`, 'u');

const IMPORT_REGEX = /^import\s+"([^"]*)"\s+as\s+(\S+)/;
const USING_REGEX = /^using\s+(.+?)\s*$/;
const CUE_REGEX = /^~\s+(\S+)/;
const MUTATION_REGEX = /^(\$>>?|do!?|set)\s/;
const CONDITION_REGEX = /^(if|elif|else\s+if|while|match|when|else)(\s|:|$)/;
/** `=> target` or `=>< target` at the end of a line. */
const GOTO_REGEX = /(?:^|\s)(=><?)\s+(\S+)\s*$/;
/** Prefixes that can come before the actual content of a dialogue line. */
const LINE_PREFIX_REGEX = /^(?:-\s+|\|\s+|%[\d.]*(?:\s+\[if\s.*?\/?\])?\s+)/;
const SPEAKER_REGEX = /^((?:\{\{.*?\}\}|\\.|[^:[\]{}\\])+?):\s/;

export interface Span {
	line: number;
	start: number;
	end: number;
}

export interface Cue extends Span {
	name: string;
}

export interface Jump extends Span {
	/** The full target text, e.g. `snippets/banter`, `start` or `END!`. */
	target: string;
	/** Import prefix if the target is `prefix/cue`. */
	prefix?: string;
	/** Cue name part of the target. */
	cue: string;
	/** Where the cue name part starts (`start` covers the prefix too). */
	cueStart: number;
	/** `=><` (jump and return) rather than `=>`. */
	returns: boolean;
	/** `END` or `END!`. */
	isEnd: boolean;
}

export interface Import extends Span {
	path: string;
	prefix: string;
	prefixStart: number;
	prefixEnd: number;
}

export interface Using extends Span {
	state: string;
}

export interface Character extends Span {
	name: string;
}

export interface ParsedDialogue {
	cues: Cue[];
	jumps: Jump[];
	imports: Import[];
	usings: Using[];
	characters: Character[];
	lineCount: number;
}

export function parseDialogue(text: string): ParsedDialogue {
	const result: ParsedDialogue = {
		cues: [],
		jumps: [],
		imports: [],
		usings: [],
		characters: [],
		lineCount: 0,
	};

	const lines = text.split(/\r?\n/);
	result.lineCount = lines.length;

	for (let line = 0; line < lines.length; line++) {
		const raw = lines[line];
		const indent = raw.length - raw.trimStart().length;
		const body = raw.slice(indent).trimEnd();

		if (body === '' || body.startsWith('#')) {
			continue;
		}

		let m: RegExpExecArray | null;

		if ((m = IMPORT_REGEX.exec(body))) {
			const pathStart = indent + body.indexOf('"') + 1;
			const prefixStart = indent + body.lastIndexOf(m[2]);
			result.imports.push({
				line,
				path: m[1],
				start: pathStart,
				end: pathStart + m[1].length,
				prefix: m[2],
				prefixStart,
				prefixEnd: prefixStart + m[2].length,
			});
			continue;
		}

		if ((m = USING_REGEX.exec(body))) {
			const start = indent + body.indexOf(m[1], 'using'.length);
			result.usings.push({ line, state: m[1], start, end: start + m[1].length });
			continue;
		}

		if ((m = CUE_REGEX.exec(body))) {
			const start = indent + body.indexOf(m[1], 1);
			result.cues.push({ line, name: m[1], start, end: start + m[1].length });
			continue;
		}

		// Mutations and conditions are expressions; they never contain jumps or speakers.
		if (MUTATION_REGEX.test(body) || CONDITION_REGEX.test(body)) {
			continue;
		}

		const jump = parseJump(body, indent, line);
		if (jump) {
			result.jumps.push(jump);
		}

		// Everything else is some form of dialogue line (possibly a response,
		// random line or concurrent line), which may start with a character name.
		const prefix = LINE_PREFIX_REGEX.exec(body);
		const contentOffset = prefix ? prefix[0].length : 0;
		const content = body.slice(contentOffset);
		if (content.startsWith('=>') || content.startsWith('\\')) {
			continue;
		}
		const speaker = SPEAKER_REGEX.exec(content);
		if (speaker && !speaker[1].includes('{{')) {
			const name = speaker[1].trim();
			const start = indent + contentOffset + speaker[1].indexOf(name);
			result.characters.push({ line, name, start, end: start + name.length });
		}
	}

	return result;
}

function parseJump(body: string, indent: number, line: number): Jump | undefined {
	const m = GOTO_REGEX.exec(body);
	if (!m) {
		return undefined;
	}
	const target = m[2];
	const targetMatch = JUMP_TARGET_REGEX.exec(target);
	if (!targetMatch) {
		// Dynamic jumps like `=> {{some_expression}}` can't be resolved statically.
		return undefined;
	}
	// `body` is already trimmed at the end, so the target is the tail of the match.
	const start = indent + m.index + m[0].length - target.length;
	const prefix = targetMatch[1];
	const cue = targetMatch[2];
	const isEnd = cue === 'END' || cue === 'END!';
	if (!isEnd && cue.endsWith('!')) {
		return undefined;
	}
	return {
		line,
		start,
		end: start + target.length,
		target,
		prefix,
		cue,
		cueStart: prefix ? start + prefix.length + 1 : start,
		returns: m[1] === '=><',
		isEnd: isEnd && !prefix,
	};
}

/** Returns the cue whose section contains `line` (the last cue at or before it). */
export function cueAtLine(parsed: ParsedDialogue, line: number): Cue | undefined {
	let found: Cue | undefined;
	for (const cue of parsed.cues) {
		if (cue.line <= line) {
			found = cue;
		} else {
			break;
		}
	}
	return found;
}

/** Last line (inclusive) of a cue's section: the line before the next cue, minus trailing blanks. */
export function cueSectionEnd(parsed: ParsedDialogue, cueIndex: number, lines: string[]): number {
	const next = parsed.cues[cueIndex + 1];
	let end = (next ? next.line : parsed.lineCount) - 1;
	while (end > parsed.cues[cueIndex].line && (lines[end] ?? '').trim() === '') {
		end--;
	}
	return end;
}

export function isPositionIn(span: Span, line: number, character: number): boolean {
	return span.line === line && character >= span.start && character <= span.end;
}

export type DiagnosticCode =
	| 'duplicate-cue'
	| 'invalid-cue'
	| 'unknown-cue'
	| 'unknown-import'
	| 'duplicate-import';

export interface Problem extends Span {
	code: DiagnosticCode;
	message: string;
}

/**
 * Checks that only need the current file. Cross-file checks (missing import
 * files, unknown cues in imported files) are done by the extension, which can
 * read the filesystem.
 */
export function lintDialogue(parsed: ParsedDialogue): Problem[] {
	const problems: Problem[] = [];
	const cueNames = new Set<string>();

	for (const cue of parsed.cues) {
		if (!VALID_CUE_REGEX.test(cue.name)) {
			problems.push({ ...span(cue), code: 'invalid-cue', message: `Invalid cue name "${cue.name}". Cue names can only contain letters, numbers and underscores.` });
		} else if (/^\d/.test(cue.name)) {
			problems.push({ ...span(cue), code: 'invalid-cue', message: `Cue name "${cue.name}" can't begin with a number.` });
		} else if (cue.name === 'END') {
			problems.push({ ...span(cue), code: 'invalid-cue', message: `"END" is reserved and can't be used as a cue name.` });
		}
		if (cueNames.has(cue.name)) {
			problems.push({ ...span(cue), code: 'duplicate-cue', message: `Duplicate cue "${cue.name}".` });
		}
		cueNames.add(cue.name);
	}

	const prefixes = new Set<string>();
	for (const imp of parsed.imports) {
		if (prefixes.has(imp.prefix)) {
			problems.push({ line: imp.line, start: imp.prefixStart, end: imp.prefixEnd, code: 'duplicate-import', message: `Duplicate import name "${imp.prefix}".` });
		}
		prefixes.add(imp.prefix);
	}

	for (const jump of parsed.jumps) {
		if (jump.isEnd) {
			continue;
		}
		if (jump.prefix) {
			if (!prefixes.has(jump.prefix)) {
				problems.push({ line: jump.line, start: jump.start, end: jump.cueStart - 1, code: 'unknown-import', message: `No import named "${jump.prefix}".` });
			}
		} else if (!cueNames.has(jump.cue)) {
			problems.push({ ...span(jump), code: 'unknown-cue', message: `Unknown cue "${jump.cue}".` });
		}
	}

	return problems;
}

function span(s: Span): Span {
	return { line: s.line, start: s.start, end: s.end };
}
