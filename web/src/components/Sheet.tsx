import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

/**
 * The large rounded window umbrelOS opens over the wallpaper (layouts/sheet.tsx): sized to the viewport with a
 * margin, rounded only on top, drawn with the window glass recipe so the wallpaper shows through, blurred and dimmed.
 */
export function Sheet({children, className}: {children: ReactNode; className?: string}) {
	return (
		<main
			className={cn(
				'umbrel-sheet-zoom umbrel-window-glass umbrel-window-surface-top umbrel-window-chrome fixed bottom-0 left-1/2 z-10 h-[calc(100dvh-var(--sheet-top))] w-full max-w-[1320px] -translate-x-1/2 overflow-hidden',
				'md:w-[calc(100vw-25px-25px)] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]',
				className,
			)}
		>
			{children}
		</main>
	)
}

export function Wallpaper() {
	return (
		<div
			aria-hidden='true'
			className='fixed inset-0 -z-10 bg-black bg-cover bg-center'
			style={{backgroundImage: 'url(/wallpaper.svg)'}}
		/>
	)
}
