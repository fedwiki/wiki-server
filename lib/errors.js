/*
 * Federated Wiki : Node Server
 *
 * Custom error for page-not-found conditions.
 * Allows callers to distinguish 404s from unexpected errors
 * via instanceof check or the .status property.
 */

export class PageNotFoundError extends Error {
  constructor(slug) {
    super(`Page not found: ${slug}`)
    this.name = 'PageNotFoundError'
    this.status = 404
    this.slug = slug
  }
}
