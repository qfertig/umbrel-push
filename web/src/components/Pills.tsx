import {Search} from 'lucide-react'
import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

type Tab<T extends string> = {id: T; label: ReactNode; /** Spoken name when the visible label has parts that run together for assistive tech */ name?: string}

// Pill-shaped single choice, after umbrelOS's SegmentedControl in its `muted-primary` variant
function SegmentedControl<T extends string>({
	value,
	onValueChange,
	tabs,
	ariaLabel,
	className,
	tabClassName,
}: {
	value: T
	onValueChange: (value: T) => void
	tabs: readonly Tab<T>[]
	ariaLabel: string
	className?: string
	tabClassName?: string
}) {
	return (
		<div
			role='group'
			aria-label={ariaLabel}
			className={cn('flex shrink-0 gap-0 rounded-full border-[0.5px] border-white/6 bg-white/3', className)}
		>
			{tabs.map((tab) => {
				const selected = value === tab.id
				return (
					<button
						key={tab.id}
						type='button'
						aria-pressed={selected}
						aria-label={tab.name}
						onClick={() => onValueChange(tab.id)}
						className={cn(
							'group relative grow rounded-full leading-inter-trimmed outline-hidden transition-[box-shadow,background] focus-visible:ring-2 focus-visible:ring-white/25',
							selected && 'bg-brand/45 shadow-button-highlight-soft-hpx',
							tabClassName,
						)}
					>
						<span
							className={cn(
								'relative z-10 flex items-center justify-center gap-1.5 transition-opacity duration-200',
								!selected && 'opacity-75 group-hover:opacity-90',
							)}
						>
							{tab.label}
						</span>
					</button>
				)
			})}
		</div>
	)
}

// Controls on the "edge material" surface, after umbrelOS's edge-controls: white/6 fill that steps up on hover
export function FilterPills<T extends string>(props: {
	value: T
	onValueChange: (value: T) => void
	tabs: readonly Tab<T>[]
	ariaLabel: string
	className?: string
}) {
	return (
		<SegmentedControl
			{...props}
			className={cn(
				'settings-edge-material umbrel-hide-scrollbar h-11 min-w-0 shrink gap-1 overflow-x-auto rounded-24 border-0 bg-white/6 p-1.5 text-13 text-white',
				props.className,
			)}
			tabClassName='flex shrink-0 items-center justify-center gap-1.5 px-3 pb-0 font-medium -tracking-2 hover:bg-white/10'
		/>
	)
}

export function SearchField({
	value,
	onChange,
	label,
	className,
	disabled,
}: {
	value: string
	onChange: (value: string) => void
	label: string
	className?: string
	disabled?: boolean
}) {
	return (
		<div
			className={cn(
				'settings-edge-material flex h-11 w-[220px] shrink-0 items-center gap-2 overflow-hidden rounded-24 bg-white/6 px-3 text-white/70 transition-colors duration-200 focus-within:bg-white/12 focus-within:text-white hover:bg-white/9',
				disabled && 'pointer-events-none opacity-40',
				className,
			)}
		>
			<Search className='size-4 shrink-0' aria-hidden='true' />
			<input
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') onChange('')
				}}
				placeholder={label}
				aria-label={label}
				className='min-w-0 flex-1 bg-transparent text-12 text-white outline-hidden placeholder:text-white/50'
			/>
		</div>
	)
}
