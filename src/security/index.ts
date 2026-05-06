/**
 * Security primitives for trust-boundary hardening.
 *
 * Currently exports the sanitiser foundation (PRD #103). Future slices
 * (e.g. signing, anti-replay) live alongside.
 */

export * from './sanitize/index.js'
