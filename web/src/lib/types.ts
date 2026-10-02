export type Origin = {
	kind?: 'official' | 'community' | 'custom' | 'existing' | string
	modified?: boolean
	notice?: string
}

export type App = {
	id: string
	name?: string
	version?: string
	state?: string
	port?: number
	icon?: string
	origin?: Origin
}

export type Session = {
	connected: boolean
	demo: boolean
	host: string | null
	user: string | null
	port: number | null
	version: string | null
	refreshedAt: string | null
}

export type HostKey = {type: string; fingerprint: string}

export type ConnectResult = ({status: 'connected'} & Session) | {status: 'trust'; host: string; keys: HostKey[]}

export type ConnectRequest = {host: string; user: string; port: number; password: string; trust: boolean}

export type Lifecycle = 'start' | 'stop' | 'restart'

/** Bytes per app and in total. `used` is the whole machine; `apps` maps an app id to its own share. */
export type Usage = {size: number; used: number; available?: number; apps: Record<string, number>; measuredAt: string}

/** The outcome of the latest start, stop or restart, in one plain sentence */
export type PowerNotice = {kind: 'ok' | 'error'; text: string; appId: string}

export type PackageFile = {content: string; mode: number}
export type PackageFiles = Record<string, PackageFile>

export type PortMapping = {host: number | null; container: number | null; protocol: 'tcp' | 'udp'; ip: string | null}
export type VolumeMount = {host: string; container: string; mode: string | null}

/** The structured view of a package: the fields people expect from a container manager, mapped onto Umbrel's YAML */
export type Settings = {
	appId: string
	name: string
	version: string
	icon: string | null
	dashboardPort: number | null
	path: string
	/** null when the package has no app_proxy */
	webPort: number | null
	service: string
	image: string
	containerName: string
	network: 'bridge' | 'host'
	ports: PortMapping[]
	volumes: VolumeMount[]
	environment: [string, string][]
	devices: string[]
	command: string
	privileged: boolean
	/** 0 means no limit */
	memoryMb: number
	cpuShares: number | null
	restart: string
	capAdd: string[]
}

export type ContainerImage = {container: string; configuredImage: string; runningImageId: string; state: string}

/** An app's package as the editor holds it: the files, the baseline they were retrieved at, and the settings view of them */
export type PackageView = {
	appId: string
	files: PackageFiles
	/** null for a package that is not installed yet */
	baseline: string | null
	origin: Origin | null
	images: ContainerImage[]
	backup?: string | null
	settings: Settings | null
	/** Why there is no settings view (the YAML tab still works) */
	error: string | null
}

export type PortConflict = {port: number; owner: string; kind: 'dashboard' | 'published'; suggestions: number[]}
export type PortCheck = {conflicts: PortConflict[]; used: Record<string, string>}
export type TagList = {image: string; tags: string[]; registry: 'docker-hub' | 'other'}
export type HubResult = {name: string; official: boolean; description: string}
