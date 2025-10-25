import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      './runtimeConfig': './runtimeConfig.browser', // This is needed for Amplify
    },
  },
})
