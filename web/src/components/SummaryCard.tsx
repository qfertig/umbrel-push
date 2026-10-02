import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

// After umbrelOS's SettingsSummary: a definition list on the edge material, 46px rows, dim labels.
// Below the lg breakpoint it becomes a two-column grid of label-over-value cells, so it does not fill a phone screen.
export function SummaryCard({rows, className}: {rows: readonly {label: string; value: ReactNode}[]; className?: string}) {
	return (
		<dl className={cn('settings-edge-material grid shrink-0 grid-cols-2 overflow-hidden rounded-24 text-13 -tracking-2 lg:flex lg:flex-col', className)}>
			{rows.map((row) => (
				<div
					key={row.label}
					className='flex min-w-0 flex-col items-start justify-center gap-0.5 px-5 py-3 lg:min-h-[46px] lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:border-b lg:border-white/8 lg:py-0 lg:last:border-b-0'
				>
					<dt className='shrink-0 font-semibold whitespace-nowrap text-white/45'>{row.label}</dt>
					<dd className='max-w-full min-w-0 truncate font-medium text-white lg:text-right'>{row.value}</dd>
				</div>
			))}
		</dl>
	)
}
