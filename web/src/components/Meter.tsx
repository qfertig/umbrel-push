import {formatBytes, share} from '@/lib/format'
import {cn} from '@/lib/utils'

/**
 * A small labelled bar: what `name` uses of `total`. Shows "-" when there is no reading (a stopped app holds no
 * memory, a failed read) and "…" while the first reading is on its way. `stale` dims the last value when a refresh failed.
 */
export function Meter({
	label,
	name,
	value,
	total,
	pending = false,
	stale = false,
	title,
}: {
	label: string
	name: string
	value: number | null
	total: number | null
	pending?: boolean
	stale?: boolean
	title?: string
}) {
	const known = !pending && value !== null && total !== null && total > 0
	const text = pending ? '…' : known ? formatBytes(value) : '-'
	const spoken = known ? `${text} of ${formatBytes(total)}` : pending ? 'loading' : 'no reading'
	return (
		<div title={title} className={cn('w-[104px] shrink-0 transition-opacity duration-300', stale && 'opacity-50')}>
			<div className='flex items-baseline justify-between gap-2'>
				<span className='text-11 text-white/40'>{label}</span>
				<span className='font-mono text-11 text-white/70'>{text}</span>
			</div>
			<div
				{...(known ? {role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': value} : {role: 'img'})}
				aria-label={`${name} ${label.toLowerCase()}`}
				aria-valuetext={spoken}
				className='mt-1.5 h-1 overflow-hidden rounded-full bg-white/10'
			>
				<div
					className='h-full rounded-full bg-brand transition-[width] duration-700 motion-reduce:transition-none'
					style={{width: `${known ? share(value, total) * 100 : 0}%`}}
				/>
			</div>
		</div>
	)
}
