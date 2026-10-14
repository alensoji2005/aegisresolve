import { ComplaintContract } from './complaint';
import { LifecycleContract } from './lifecycle';

export { ComplaintContract } from './complaint';
export { LifecycleContract } from './lifecycle';
export * from './types';
export * as rules from './rules';

export const contracts: any[] = [ComplaintContract, LifecycleContract];
