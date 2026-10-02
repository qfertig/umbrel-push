import '@testing-library/jest-dom/vitest'
import {cleanup} from '@testing-library/react'
import {afterEach} from 'vitest'

afterEach(cleanup)

// jsdom lacks these; Radix, CodeMirror and layout code reach for them
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false)
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {})

// CodeMirror measures text with Range geometry, which jsdom does not implement
const emptyRect = {x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({})} as DOMRect
Range.prototype.getBoundingClientRect = Range.prototype.getBoundingClientRect ?? (() => emptyRect)
Range.prototype.getClientRects =
	Range.prototype.getClientRects ?? (() => ({length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]()}) as unknown as DOMRectList)
