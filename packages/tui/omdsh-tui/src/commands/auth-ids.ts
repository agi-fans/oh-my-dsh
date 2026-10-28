/**
 * Identifiers shared by the auth input, provider, and flow modules.
 *
 * They live in their own module because all three need them and any other
 * arrangement makes a cycle: the provider table needs the provider id, the flows
 * need the sentinel values, and `commands/auth.ts` needs all of it to register.
 *
 * @module @agi-fans/dsh-tui/commands/auth-ids
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** The official DeepSeek route this product ships by default. */
export const DEEPSEEK_PROVIDER = 'deepseek-official'
/** Credential reference the official route reads. */
export const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')
/** Settings entry the official route is configured under. */
export const DEEPSEEK_SETTINGS = 'llm-deepseek'
/** Settings entry the multi-provider pi-ai adapter is configured under. */
export const PI_AI_SETTINGS = 'llm-pi-ai'

/** Marker the picker returns for "add a provider that is not in the catalog". */
export const CUSTOM_PROVIDER_VALUE = '__omdsh_custom__'
/** Sentinel the picker returns for "sign in to the DeepSeek account". */
export const DEEPSEEK_ACCOUNT_CHOICE = '__omdsh_deepseek_account__'
/** Prefix a picker value carries when it names an authorization flow. */
export const FLOW_VALUE_PREFIX = '__omdsh_flow__:'
/** Settings namespace the pi-ai route records its providers under. */
export const PI_AI_RECORD_SCOPE = 'llm-pi-ai'
