import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'

/** The last question before anything reaches the Umbrel, with the consequences that matter for this particular push. */
export function PushDialog({name, host, isUpdate, pull, onCancel, onConfirm}: {name: string; host: string; isUpdate: boolean; pull: boolean; onCancel: () => void; onConfirm: () => void}) {
	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent aria-describedby='push-description'>
				<DialogHeader>
					<DialogTitle>
						Push {name} to {host}?
					</DialogTitle>
					<DialogDescription id='push-description'>
						{isUpdate
							? 'This applies your changes to the installed app. A configuration backup is saved first, and a running app restarts.'
							: 'This installs the app on the Umbrel.'}
					</DialogDescription>
				</DialogHeader>
				{pull ? <p className='text-13 -tracking-2 text-amber-300'>New images will be pulled. Restoring the configuration does not undo data migrations.</p> : null}
				<DialogFooter>
					<Button size='dialog' onClick={onCancel}>
						Cancel
					</Button>
					<Button size='dialog' variant='primary' onClick={onConfirm}>
						Push
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
