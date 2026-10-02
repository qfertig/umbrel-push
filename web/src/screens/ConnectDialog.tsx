import {useState, type FormEvent} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {Input, InputError, Labeled} from '@/components/Input'
import {api, ApiError, metaContent} from '@/lib/api'
import type {HostKey, Session} from '@/lib/types'

const STORAGE_KEY = 'umbrel-push-connection'

type Remembered = {host: string; user: string; port: number}

function remembered(): Remembered {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
		return {host: String(value.host || metaContent('umbrel-push-default-host')), user: String(value.user ?? 'umbrel'), port: Number(value.port ?? 22)}
	} catch {
		return {host: metaContent('umbrel-push-default-host'), user: 'umbrel', port: 22}
	}
}

function remember(value: Remembered) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
	} catch {
		// the form still works without it
	}
}

/** Host and password in, working connection out. The host-key step is its own screen so the fingerprint is never skipped. */
export function ConnectDialog({
	session,
	onClose,
	onConnected,
	onDisconnect,
}: {
	session: Session | null
	onClose: () => void
	onConnected: (session: Session) => void
	onDisconnect: () => void
}) {
	const saved = remembered()
	const [host, setHost] = useState(session?.host ?? saved.host)
	const [user, setUser] = useState(session?.user ?? saved.user)
	const [port, setPort] = useState(String(session?.port ?? saved.port))
	const [password, setPassword] = useState('')
	const [advanced, setAdvanced] = useState(user !== 'umbrel' || port !== '22')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [keys, setKeys] = useState<HostKey[] | null>(null)

	const submit = async (trust: boolean) => {
		setBusy(true)
		setError('')
		try {
			const result = await api.connect({host: host.trim(), user: user.trim() || 'umbrel', port: Number(port) || 22, password, trust})
			if (result.status === 'trust') {
				setKeys(result.keys)
				return
			}
			remember({host: host.trim(), user: user.trim() || 'umbrel', port: Number(port) || 22})
			setPassword('')
			onConnected(result)
		} catch (failure) {
			setKeys(null)
			setError(failure instanceof ApiError || failure instanceof Error ? failure.message : 'The connection failed.')
		} finally {
			setBusy(false)
		}
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		void submit(false)
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent aria-describedby='connect-description'>
				{keys ? (
					<>
						<DialogHeader>
							<DialogTitle>First connection to {host.trim()}</DialogTitle>
							<DialogDescription id='connect-description'>
								Compare this fingerprint with the output of ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub on the Umbrel. Trusting it
								saves the key to ~/.ssh/known_hosts.
							</DialogDescription>
						</DialogHeader>
						<ul className='flex flex-col gap-2 rounded-12 bg-white/6 p-3 font-mono text-12 text-white/80 select-text'>
							{keys.map((key) => (
								<li key={key.fingerprint} className='break-all'>
									<span className='text-white/45'>{key.type}</span> {key.fingerprint}
								</li>
							))}
						</ul>
						{error ? <InputError>{error}</InputError> : null}
						<DialogFooter>
							<Button size='dialog' disabled={busy} onClick={() => setKeys(null)}>
								Cancel
							</Button>
							<Button size='dialog' variant='primary' disabled={busy} onClick={() => void submit(true)}>
								Trust and connect
							</Button>
						</DialogFooter>
					</>
				) : (
					<form onSubmit={onSubmit} className='flex flex-col gap-5'>
						<DialogHeader>
							<DialogTitle>Connect to Umbrel</DialogTitle>
							<DialogDescription id='connect-description'>
								The password is used for sudo on the Umbrel and, the first time, to let this computer's key in. It stays in memory until
								you disconnect.
							</DialogDescription>
						</DialogHeader>
						<Labeled label='Host'>
							<Input
								value={host}
								onChange={(event) => setHost(event.target.value)}
								placeholder='192.168.1.104 or umbrel.local'
								autoFocus={!host}
								spellCheck={false}
								autoComplete='off'
								disabled={busy}
							/>
						</Labeled>
						<Labeled label='Password'>
							<Input
								type='password'
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoFocus={Boolean(host)}
								name='password'
								autoComplete='current-password'
								disabled={busy}
							/>
						</Labeled>
						<div>
							<button
								type='button'
								aria-expanded={advanced}
								onClick={() => setAdvanced((value) => !value)}
								className='rounded-full px-[5px] text-12 text-white/50 outline-hidden hover:text-white/70 focus-visible:ring-2 focus-visible:ring-white/25'
							>
								Advanced
							</button>
							{advanced ? (
								<div className='mt-3 grid grid-cols-[1fr_96px] gap-3'>
									<Labeled label='SSH user'>
										<Input value={user} onChange={(event) => setUser(event.target.value)} spellCheck={false} disabled={busy} />
									</Labeled>
									<Labeled label='SSH port'>
										<Input
											value={port}
											onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
											inputMode='numeric'
											disabled={busy}
										/>
									</Labeled>
								</div>
							) : null}
						</div>
						{busy ? (
							<p role='status' className='text-13 text-white/45'>
								Connecting. The first time can take a few seconds.
							</p>
						) : null}
						{error ? <InputError>{error}</InputError> : null}
						<DialogFooter>
							{session?.connected && !session.demo ? (
								<Button size='dialog' disabled={busy} onClick={onDisconnect} className='md:mr-auto'>
									Disconnect
								</Button>
							) : null}
							<Button size='dialog' disabled={busy} onClick={onClose}>
								Cancel
							</Button>
							<Button size='dialog' variant='primary' type='submit' disabled={busy || !host.trim()}>
								Connect
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}
