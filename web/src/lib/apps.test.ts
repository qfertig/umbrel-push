import {describe as suite, expect, it} from 'vitest'

import {countBySource, describe, filterApps, joinImage, lifecycleActions, splitImage, tagName, usableIcon} from './apps'
import type {App} from './types'

const apps: App[] = [
	{id: 'dockge', name: 'Dockge', state: 'ready', port: 5001, origin: {kind: 'official'}},
	{id: 'scrutiny', name: 'Scrutiny', state: 'ready', origin: {kind: 'community', modified: true}},
	{id: 'push-smoke', name: 'Umbrel Push Test', state: 'stopped', origin: {kind: 'custom'}},
	{id: 'odd', state: 'waiting-for-update'},
]

suite('describe', () => {
	it('names the state and picks one tone for it', () => {
		expect(describe(apps[0])).toMatchObject({stateText: 'Running', tone: 'ok', note: ''})
		expect(describe(apps[2])).toMatchObject({stateText: 'Stopped', tone: 'muted', note: 'Managed here'})
		expect(describe(apps[3])).toMatchObject({name: 'odd', stateText: 'Waiting For Update', tone: 'warn', kind: 'existing'})
	})

	it('says only what is true about local edits', () => {
		expect(describe(apps[1]).note).toBe('Edited locally')
		expect(describe(apps[0]).note).toBe('')
	})
})

suite('filterApps', () => {
	it('filters by source and by name or id together', () => {
		expect(filterApps(apps, 'custom', '').map((app) => app.id)).toEqual(['push-smoke'])
		expect(filterApps(apps, 'all', 'SCRUT').map((app) => app.id)).toEqual(['scrutiny'])
		expect(filterApps(apps, 'official', 'scrut')).toEqual([])
		expect(filterApps(apps, 'all', '  smoke ').map((app) => app.id)).toEqual(['push-smoke'])
	})

	it('counts every source', () => {
		expect(countBySource(apps)).toEqual({all: 4, official: 1, community: 1, custom: 1})
	})
})

suite('usableIcon', () => {
	it('ignores the transparent placeholder and non-image values', () => {
		const placeholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
		expect(usableIcon({id: 'a', icon: placeholder})).toBeNull()
		expect(usableIcon({id: 'a', icon: 'javascript:alert(1)'})).toBeNull()
		expect(usableIcon({id: 'a', icon: 'http://insecure.example/i.png'})).toBeNull()
		expect(usableIcon({id: 'a'})).toBeNull()
		expect(usableIcon({id: 'a', icon: 'https://example.com/i.png'})).toBe('https://example.com/i.png')
	})
})

suite('splitImage and joinImage', () => {
	const digest = '@sha256:536b970e'
	it.each([
		['org/app:1.2', ['org/app', '1.2']],
		['org/app', ['org/app', '']],
		['org/app:v4.48.0' + digest, ['org/app', 'v4.48.0' + digest]],
		['org/app' + digest, ['org/app', digest]],
		['localhost:5000/app', ['localhost:5000/app', '']],
		['localhost:5000/app:2', ['localhost:5000/app', '2']],
		['localhost:5000/app:2' + digest, ['localhost:5000/app', '2' + digest]],
	])('splits %s', (image, expected) => {
		expect(splitImage(image)).toEqual(expected)
	})

	it('round trips every form and drops the digest when a tag is picked', () => {
		for (const image of ['org/app:1.2', 'org/app', 'org/app:1' + digest, 'org/app' + digest, 'localhost:5000/app:2']) {
			expect(joinImage(...splitImage(image))).toBe(image)
		}
		expect(joinImage('org/app', 'v5.1.3')).toBe('org/app:v5.1.3')
	})

	it('compares the tag name only for the Current marker', () => {
		expect(tagName('v4.48.0' + digest)).toBe('v4.48.0')
		expect(tagName(digest)).toBe('')
		expect(tagName('1.2')).toBe('1.2')
	})
})

suite('lifecycleActions', () => {
	it('offers Start for a stopped app and Restart and Stop for a running one', () => {
		expect(lifecycleActions({id: 'a', state: 'stopped'})).toEqual(['start'])
		expect(lifecycleActions({id: 'a', state: 'ready'})).toEqual(['restart', 'stop'])
		expect(lifecycleActions({id: 'a', state: 'running'})).toEqual(['restart', 'stop'])
	})

	it('offers nothing while the app is changing state or unknown', () => {
		for (const state of ['starting', 'stopping', 'restarting', 'updating', 'unknown', undefined]) {
			expect(lifecycleActions({id: 'a', state})).toEqual([])
		}
	})
})
