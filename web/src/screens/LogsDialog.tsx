import {useCallback, useEffect, useState} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {api} from '@/lib/api'

type State = {status: 'loading'} | {status: 'ready'; text: string} | {status: 'error'; message: string}

/** Recent lifecycle and container output for one app, as umbreld reports it. */
export function LogsDialog({appId, name, onClose}: {appId: string; name: string; onClose: () => void}) {
	const [state, setState] = useState<State>({status: 'loading'})

	const load = useCallback(async () => {
		setState({status: 'loading'})
		try {
			setState({status: 'ready', text: (await api.logs(appId)).text})
		} catch (error) {
			setState({status: 'error', message: error instanceof Error ? error.message : 'The logs could not be read.'})
		}
	}, [appId])

	useEffect(() => void load(), [load])

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className='sm:max-w-[720px]' aria-describedby='logs-description'>
				<DialogHeader>
					<DialogTitle>Logs for {name}</DialogTitle>
					<DialogDescription id='logs-description'>Recent lifecycle and container output as reported by umbreld.</DialogDescription>
				</DialogHeader>
				<div aria-live='polite' className='rounded-12 bg-white/6 p-3'>
					{state.status === 'loading' ? <p className='text-12 text-white/45'>Reading logs…</p> : null}
					{state.status === 'error' ? <p className='text-12 text-destructive2-lightest select-text'>{state.message}</p> : null}
					{state.status === 'ready' ? (
						<pre className='umbrel-scrollbar max-h-[360px] overflow-auto font-mono text-12 leading-snug whitespace-pre-wrap text-white/70 select-text'>
							{state.text || 'The app has not logged anything yet.'}
						</pre>
					) : null}
				</div>
				<DialogFooter>
					<Button size='dialog' disabled={state.status === 'loading'} onClick={() => void load()}>
						Reload logs
					</Button>
					<Button size='dialog' variant='primary' onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
