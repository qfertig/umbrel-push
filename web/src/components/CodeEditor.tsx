import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands'
import {yaml} from '@codemirror/lang-yaml'
import {HighlightStyle, indentOnInput, syntaxHighlighting} from '@codemirror/language'
import {EditorState, type Extension} from '@codemirror/state'
import {Decoration, type DecorationSet, EditorView, highlightActiveLine, keymap, lineNumbers, ViewPlugin, type ViewUpdate} from '@codemirror/view'
import {tags} from '@lezer/highlight'
import {useEffect, useRef} from 'react'

import {cn} from '@/lib/utils'

export type CodeMode = 'yaml' | 'diff' | 'text'

// Colours come from the same tokens as the rest of the interface, so the editor follows the brand colour
const theme = EditorView.theme(
	{
		'&': {height: '100%', color: 'rgb(255 255 255 / 0.85)', backgroundColor: 'transparent', fontSize: '12.5px'},
		'&.cm-focused': {outline: '2px solid var(--focus-ring)', outlineOffset: '-2px'},
		'.cm-scroller': {fontFamily: 'var(--font-mono)', lineHeight: '1.55', overflow: 'auto'},
		'.cm-content': {padding: '14px 0', caretColor: 'white'},
		'.cm-line': {padding: '0 16px 0 8px'},
		'.cm-gutters': {backgroundColor: 'rgb(255 255 255 / 0.03)', color: 'rgb(255 255 255 / 0.3)', border: 'none', borderRight: '0.5px solid rgb(255 255 255 / 0.08)'},
		'.cm-activeLine': {backgroundColor: 'rgb(255 255 255 / 0.05)'},
		'.cm-activeLineGutter': {backgroundColor: 'rgb(255 255 255 / 0.06)', color: 'rgb(255 255 255 / 0.7)'},
		'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {backgroundColor: 'hsl(var(--color-brand-hsl) / 0.35) !important'},
		'.cm-cursor': {borderLeftColor: 'white'},
		'.cm-diff-add': {backgroundColor: 'rgb(60 170 100 / 0.18)', color: 'rgb(190 240 205)'},
		'.cm-diff-del': {backgroundColor: 'rgb(230 70 70 / 0.18)', color: 'rgb(250 195 195)'},
		'.cm-diff-hunk': {color: 'hsl(var(--color-brand-lightest-hsl))'},
		'.cm-diff-file': {color: 'rgb(255 255 255 / 0.55)', fontWeight: '600'},
	},
	{dark: true},
)

const highlight = HighlightStyle.define([
	{tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'hsl(var(--color-brand-lightest-hsl))'},
	{tag: [tags.string, tags.special(tags.string)], color: 'rgb(255 255 255 / 0.9)'},
	{tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'hsl(200 70% 78%)'},
	{tag: [tags.meta, tags.processingInstruction], color: 'hsl(300 40% 78%)'},
	{tag: tags.comment, color: 'rgb(255 255 255 / 0.4)', fontStyle: 'italic'},
	{tag: [tags.separator, tags.punctuation], color: 'rgb(255 255 255 / 0.5)'},
])

const lineClass = {
	add: Decoration.line({class: 'cm-diff-add'}),
	del: Decoration.line({class: 'cm-diff-del'}),
	hunk: Decoration.line({class: 'cm-diff-hunk'}),
	file: Decoration.line({class: 'cm-diff-file'}),
}

function diffDecorations(view: EditorView): DecorationSet {
	const ranges = []
	for (let number = 1; number <= view.state.doc.lines; number++) {
		const line = view.state.doc.line(number)
		const text = line.text
		const kind = text.startsWith('+++') || text.startsWith('---') ? 'file' : text.startsWith('@@') ? 'hunk' : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'del' : null
		if (kind) ranges.push(lineClass[kind].range(line.from))
	}
	return Decoration.set(ranges)
}

const diffView = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet
		constructor(view: EditorView) {
			this.decorations = diffDecorations(view)
		}
		update(update: ViewUpdate) {
			if (update.docChanged) this.decorations = diffDecorations(update.view)
		}
	},
	{decorations: (plugin) => plugin.decorations},
)

function extensionsFor(mode: CodeMode, readOnly: boolean, onChange: (value: string) => void): Extension[] {
	return [
		lineNumbers(),
		highlightActiveLine(),
		history(),
		indentOnInput(),
		syntaxHighlighting(highlight),
		theme,
		keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
		EditorState.readOnly.of(readOnly),
		EditorView.editable.of(!readOnly),
		EditorView.contentAttributes.of({spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off'}),
		mode === 'yaml' ? yaml() : [],
		mode === 'diff' ? diffView : [],
		EditorView.updateListener.of((update) => {
			if (update.docChanged) onChange(update.state.doc.toString())
		}),
	]
}

/**
 * A code editor with line numbers and highlighting: YAML for the package files, a coloured unified diff for the
 * Changes tab, plain text otherwise. `value` is the source of truth; typing reports through `onChange`.
 */
export function CodeEditor({
	value,
	onChange,
	readOnly = false,
	mode = 'yaml',
	label,
	className,
}: {
	value: string
	onChange?: (value: string) => void
	readOnly?: boolean
	mode?: CodeMode
	label: string
	className?: string
}) {
	const host = useRef<HTMLDivElement>(null)
	const view = useRef<EditorView | null>(null)
	const latest = useRef(onChange)
	latest.current = onChange

	useEffect(() => {
		const element = host.current
		if (!element) return
		const editor = new EditorView({
			parent: element,
			state: EditorState.create({doc: value, extensions: extensionsFor(mode, readOnly, (next) => latest.current?.(next))}),
		})
		view.current = editor
		return () => {
			editor.destroy()
			view.current = null
		}
		// The editor is rebuilt only when its kind changes; new text arrives through the effect below
	}, [mode, readOnly])

	useEffect(() => {
		const editor = view.current
		if (editor && editor.state.doc.toString() !== value) {
			editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: value}})
		}
	}, [value])

	return <div ref={host} role='group' aria-label={label} className={cn('min-h-0 overflow-hidden rounded-24 bg-white/4', className)} />
}
