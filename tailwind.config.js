const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js,ts,jsx,tsx}", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', /* ...other sans fonts */],
        serif: ['ui-serif', 'Georgia', 'Cambria', "Times New Roman", 'Times', 'serif'],
      },
      // colors: {
      //   'brand-green': '#385434',
      // },
      // borderColor: theme => ({
      //   ...theme('colors'),
      //   DEFAULT: theme('colors.gray.300', 'currentColor'),
      //   'brand-green': '#385434',
      // }),
      // ringColor: theme => ({
      //   ...theme('colors'),
      //   DEFAULT: theme('colors.blue.500', '#2563eb'),
      //   'brand-green': '#385434',
      // }),
    },
  },
  plugins: [],
} 