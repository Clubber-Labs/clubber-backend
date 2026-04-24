import { resolve } from 'node:path'
import { config } from 'dotenv'

export default function setup() {
  config({ path: resolve(process.cwd(), '.env.test') })
}
