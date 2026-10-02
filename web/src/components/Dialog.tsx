import * as DialogPrimitive from '@radix-ui/react-dialog'
import type {ComponentProps, ReactNode} from 'react'

import {cn} from '@/lib/utils'

export const Dialog = DialogPrimitive.Root

// Overlay and content classes follow umbrelOS's shared dialog classes (components/ui/shared/dialog.ts)
export function DialogContent({className, children, ...props}: ComponentProps<typeof DialogPrimitive.Content>) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/60 contrast-more:bg-black/90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0' />
			<DialogPrimitive.Content
				className={cn(
					'umbrel-material umbrel-material-modal fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100%-16px)] w-full max-w-[calc(100%-40px)] translate-x-[-50%] translate-y-[-50%] flex-col gap-5 p-8 outline-hidden duration-200 sm:max-w-[480px]',
					'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close className='absolute top-3 right-3 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&>svg]:opacity-30 hover:[&>svg]:opacity-40 focus-visible:[&>svg]:opacity-60'>
					<svg viewBox='0 0 24 24' fill='currentColor' className='size-6' aria-hidden='true'>
						<path d='M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z' />
					</svg>
					<span className='sr-only'>Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	)
}

export function DialogTitle({className, ...props}: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn('text-left text-17 leading-snug font-semibold -tracking-2', className)} {...props} />
}

export function DialogDescription({className, ...props}: ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			className={cn('text-left text-13 leading-tight font-normal -tracking-2 text-white/40', className)}
			{...props}
		/>
	)
}

export function DialogHeader({children}: {children: ReactNode}) {
	return <div className='flex flex-col gap-1.5 pr-6'>{children}</div>
}

export function DialogFooter({children}: {children: ReactNode}) {
	return <div className='flex flex-col gap-2.5 md:flex-row md:justify-end'>{children}</div>
}
