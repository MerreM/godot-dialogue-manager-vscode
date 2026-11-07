import * as assert from 'assert';
import { cueAtLine, cueSectionEnd, lintDialogue, parseDialogue } from '../../parser';

suite('parseDialogue', () => {
	test('finds cues with positions', () => {
		const parsed = parseDialogue('~ start\nNathan: Hi\n\t~ nested_ok\n~ 你好');
		assert.deepStrictEqual(parsed.cues.map((c) => [c.name, c.line, c.start, c.end]), [
			['start', 0, 2, 7],
			['nested_ok', 2, 3, 12],
			['你好', 3, 2, 4],
		]);
	});

	test('finds jumps on goto lines, responses and random lines', () => {
		const text = [
			'=> start',
			'=>< snippets/banter',
			'- Response => other',
			'- Conditional [if x /] => other',
			'% => random_target',
			'%2 [if y /] => weighted',
			'\t=> END',
			'=> END!',
			'=> {{dynamic}}',
		].join('\n');
		const jumps = parseDialogue(text).jumps;
		assert.deepStrictEqual(jumps.map((j) => [j.target, j.prefix, j.cue, j.returns, j.isEnd]), [
			['start', undefined, 'start', false, false],
			['snippets/banter', 'snippets', 'banter', true, false],
			['other', undefined, 'other', false, false],
			['other', undefined, 'other', false, false],
			['random_target', undefined, 'random_target', false, false],
			['weighted', undefined, 'weighted', false, false],
			['END', undefined, 'END', false, true],
			['END!', undefined, 'END!', false, true],
		]);
		const prefixed = jumps[1];
		assert.strictEqual(prefixed.start, 4);
		assert.strictEqual(prefixed.cueStart, 13);
		assert.strictEqual(prefixed.end, 19);
		assert.strictEqual(jumps[2].start, '- Response => '.length);
		assert.strictEqual(jumps[6].start, 4);
	});

	test('ignores jumps in comments, mutations and conditions', () => {
		const text = ['# => nope', '$> foo(1) => 2', 'if a => b', 'Nathan: ok'].join('\n');
		assert.strictEqual(parseDialogue(text).jumps.length, 0);
	});

	test('parses imports and usings', () => {
		const parsed = parseDialogue('import "res://a/b.dialogue" as snip\nusing SomeGlobal\n');
		assert.strictEqual(parsed.imports.length, 1);
		const imp = parsed.imports[0];
		assert.strictEqual(imp.path, 'res://a/b.dialogue');
		assert.strictEqual(imp.prefix, 'snip');
		assert.strictEqual(imp.start, 8);
		assert.strictEqual(imp.end, 8 + 'res://a/b.dialogue'.length);
		assert.strictEqual(imp.prefixStart, 31);
		assert.deepStrictEqual(parsed.usings.map((u) => u.state), ['SomeGlobal']);
	});

	test('finds character names', () => {
		const text = [
			'Nathan: Hello',
			'- Coco: A response with a speaker',
			'| Lilly: Concurrent',
			'%2 Old Man: Random',
			'No speaker here.',
			'\\Escaped: not a speaker',
			'{{name}}: dynamic',
			'Time is 10:30 now',
			'if a: b',
		].join('\n');
		assert.deepStrictEqual(parseDialogue(text).characters.map((c) => c.name), ['Nathan', 'Coco', 'Lilly', 'Old Man']);
	});

	test('handles CRLF line endings', () => {
		const parsed = parseDialogue('~ start\r\nNathan: Hi\r\n=> start\r\n');
		assert.strictEqual(parsed.cues[0].end, 7);
		assert.strictEqual(parsed.jumps[0].end, 8);
	});

	test('cueAtLine and cueSectionEnd', () => {
		const text = 'intro\n~ a\nline\n\n~ b\nline\n';
		const parsed = parseDialogue(text);
		assert.strictEqual(cueAtLine(parsed, 0), undefined);
		assert.strictEqual(cueAtLine(parsed, 3)?.name, 'a');
		assert.strictEqual(cueAtLine(parsed, 5)?.name, 'b');
		const lines = text.split('\n');
		assert.strictEqual(cueSectionEnd(parsed, 0, lines), 2);
		assert.strictEqual(cueSectionEnd(parsed, 1, lines), 5);
	});
});

suite('lintDialogue', () => {
	test('reports unknown cues but not END', () => {
		const problems = lintDialogue(parseDialogue('~ start\n=> start\n=> missing\n=> END\n=> END!'));
		assert.deepStrictEqual(problems.map((p) => [p.code, p.line]), [['unknown-cue', 2]]);
	});

	test('reports duplicate and invalid cues', () => {
		const problems = lintDialogue(parseDialogue('~ a\n~ a\n~ 1abc\n~ bad-name\n~ END'));
		assert.deepStrictEqual(problems.map((p) => [p.code, p.line]), [
			['duplicate-cue', 1],
			['invalid-cue', 2],
			['invalid-cue', 3],
			['invalid-cue', 4],
		]);
	});

	test('reports unknown and duplicate import prefixes', () => {
		const text = 'import "res://a.dialogue" as a\nimport "res://b.dialogue" as a\n=> a/x\n=> b/y';
		const problems = lintDialogue(parseDialogue(text));
		assert.deepStrictEqual(problems.map((p) => [p.code, p.line, p.start, p.end]), [
			['duplicate-import', 1, 29, 30],
			['unknown-import', 3, 3, 4],
		]);
	});
});
