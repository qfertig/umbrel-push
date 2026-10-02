import * as SwitchPrimitive from '@radix-ui/react-switch'
import type {ComponentProps} from 'react'

import {cn} from '@/lib/utils'

// The track and thumb of umbrelOS's switch (ListRowSwitchIndicator): 36 by 20, the brand colour when on
export function Switch({className, ...props}: ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			className={cn(
				'inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full border-2 border-transparent outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40 data-[state=checked]:bg-brand data-[state=unchecked]:bg-white/10',
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className='pointer-events-none block size-4 rounded-full bg-white shadow-lg transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0' />
		</SwitchPrimitive.Root>
	)
}
