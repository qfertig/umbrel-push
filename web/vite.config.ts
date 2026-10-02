import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vitest/config'

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
	server: {
		port: 5173,
		// `changeOrigin` rewrites Host so the local server's DNS-rebinding check accepts the proxied request
		proxy: {'/api': {target: 'http://127.0.0.1:8765', changeOrigin: true}},
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/test/setup.ts'],
		css: false,
	},
})
