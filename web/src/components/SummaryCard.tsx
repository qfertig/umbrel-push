import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

// After umbrelOS's SettingsSummary: a definition list on the edge material, 46px rows, dim labels
export function SummaryCard({rows, className}: {rows: readonly {label: string; value: ReactNode}[]; className?: string}) {
	return (
		<dl className={cn('settings-edge-material shrink-0 overflow-hidden rounded-24 text-13 -tracking-2', className)}>
			{rows.map((row) => (
				<div key={row.label} className='flex min-h-[46px] items-center justify-between gap-4 border-b border-white/8 px-5 last:border-b-0'>
					<dt className='shrink-0 font-semibold whitespace-nowrap text-white/45'>{row.label}</dt>
					<dd className='min-w-0 truncate text-right font-medium text-white'>{row.value}</dd>
				</div>
			))}
		</dl>
	)
}
