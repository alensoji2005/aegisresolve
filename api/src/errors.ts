export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export const notFound = (what = 'resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = () => new ApiError(403, 'FORBIDDEN', 'not allowed');
