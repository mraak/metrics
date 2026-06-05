import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: '#1a2030',
        accent: '#3b5bdb',
        danger: '#e03131',
        success: '#2f9e44',
      },
    },
  },
  plugins: [],
}

export default config
