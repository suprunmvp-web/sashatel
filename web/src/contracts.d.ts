export interface RegisterInput {first_name:string;last_name:string;email:string;phone:string;password:string}
export interface Account {id:string;first_name:string|null;last_name:string|null;display_name:string|null;email:string;email_verified:boolean;phone:string|null;phone_verified:false}
export interface Organization {id:string;inn:string;legal_name:string;membership_id:string;role:'owner'|'admin'|'employee';status:'active'|'suspended';verification_status:'unverified'|'verified'}
export interface Context {id:string;organization:Organization;context_epoch:number;expires_at:string}
export interface Challenge {challenge_id:string;email:string;expires_at:string;resend_at:string;can_verify:boolean;delivery:{state:'queued'|'accepted'|'failed';retryable:boolean}}
export interface Bootstrap {account:Account|null;family_id:string|null;context:Context|null;challenge:Challenge|null;verification_completion_available:boolean}
export interface ApiFailure {code:string;message:string;request_id?:string;retry_after_seconds?:number}
