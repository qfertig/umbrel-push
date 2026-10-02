import {cva, type VariantProps} from 'class-variance-authority'
import type {ComponentProps} from 'react'

import {cn} from '@/lib/utils'

// Variants and sizes follow umbrelOS's button (packages/ui/src/components/ui/button.tsx).
// `pt-[1.5px]` optically re-centres the label; `bg-clip-padding` keeps the fill inside the hairline border.
const buttonVariants = cva(
	'inline-flex shrink-0 items-center justify-center gap-1.5 bg-clip-padding pt-[1.5px] font-medium -tracking-2 leading-inter-trimmed transition-[color,background-color,scale,box-shadow,opacity] duration-300 focus:outline-hidden focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
	{
		variants: {
			variant: {
				default:
					'border-[0.5px] border-white/20 bg-white/10 text-white shadow-button-highlight-soft-hpx ring-white/20 hover:bg-white/15 focus-visible:border-white/20 focus-visible:bg-white/10 active:bg-white/6 data-[state=open]:bg-white/10',
				primary:
					'bg-brand text-white shadow-button-highlight-hpx ring-brand/40 hover:bg-brand-lighter focus-visible:bg-brand-lighter active:bg-brand data-[state=open]:bg-brand-lighter',
				secondary: 'bg-white/90 text-black ring-white/40 hover:bg-white focus-visible:bg-white active:bg-white',
				destructive:
					'bg-destructive2 text-white shadow-button-highlight-hpx ring-destructive/40 hover:bg-destructive2-lighter focus-visible:bg-destructive2-lighter active:bg-destructive2',
			},
			size: {
				sm: 'h-[25px] rounded-full px-[10px] text-12 gap-2',
				md: 'h-[30px] min-w-[80px] rounded-full px-4 text-13',
				default: 'h-[30px] rounded-full px-2.5 text-12',
				dialog: 'h-[42px] w-full min-w-[80px] rounded-full px-4 text-13 font-semibold md:h-[30px] md:w-auto md:font-medium',
				lg: 'h-[40px] rounded-full px-[15px] text-15',
				icon: 'size-[30px] rounded-full px-0',
			},
		},
		defaultVariants: {variant: 'default', size: 'default'},
	},
)

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({className, variant, size, type = 'button', ...props}: ButtonProps) {
	return <button type={type} className={cn(buttonVariants({variant, size}), className)} {...props} />
}
