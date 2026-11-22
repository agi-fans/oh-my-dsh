import fs from 'node:fs'
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)

const candidateBrowsers = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate): candidate is string => Boolean(candidate))

const detectedBrowser = candidateBrowsers.find((executable) => fs.existsSync(executable))
if (detectedBrowser) {
  Config.setBrowserExecutable(detectedBrowser)
}
