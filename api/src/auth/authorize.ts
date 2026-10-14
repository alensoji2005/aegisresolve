import type { Role } from '../../../chaincode/aegis-cc/src/types.js';

export interface AuthUser { id: string; username: string; role: Role; unit: string; depot: string; pseudo: string }

export type Action =
  | 'case:create' | 'case:read:summary' | 'case:read:full' | 'evidence:upload' | 'evidence:read' | 'evidence:verify'
  | 'case:assign' | 'case:review' | 'audit:read' | 'user:admin';

export interface CaseFacts { depot: string; investigatorUserId: string | null; ownedByUser: boolean }

const OVERSIGHT: Role[] = ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'];

export function authorize(user: AuthUser, action: Action, c?: CaseFacts): boolean {
  const r = user.role;
  const assigned = !!c && c.investigatorUserId === user.id;
  switch (action) {
    case 'case:create': return r === 'COMPLAINANT' || r === 'STORE_OFFICER';
    case 'case:read:summary':
      return !!c && ((r === 'COMPLAINANT' && c.ownedByUser) || (r === 'STORE_OFFICER' && c.depot === user.depot) || OVERSIGHT.includes(r));
    case 'case:read:full':
      return !!c && ((r === 'INVESTIGATOR' && assigned) || r === 'SAFETY_OFFICER' || r === 'REVIEW_BOARD' || r === 'AUDITOR');
    case 'evidence:upload':
      return !!c && ((r === 'COMPLAINANT' && c.ownedByUser) || (r === 'STORE_OFFICER' && c.depot === user.depot) || (r === 'INVESTIGATOR' && assigned));
    case 'evidence:read':
      return !!c && ((r === 'INVESTIGATOR' && assigned) || r === 'SAFETY_OFFICER' || r === 'REVIEW_BOARD');
    case 'evidence:verify':
      return !!c && ((r === 'INVESTIGATOR' && assigned) || r === 'SAFETY_OFFICER' || r === 'REVIEW_BOARD' || r === 'AUDITOR');
    case 'case:assign':
    case 'case:review': return r === 'SAFETY_OFFICER' || r === 'REVIEW_BOARD';
    case 'audit:read': return r === 'AUDITOR' || r === 'REVIEW_BOARD';
    case 'user:admin': return r === 'ADMIN';
  }
}
