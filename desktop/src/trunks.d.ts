export type TrunkStatus = 'configuring' | 'registering' | 'registered' | 'ready' | 'rejected' | 'degraded';

export interface Trunk {
  id: string;
  registrar: string;
  auth_mode: 'registration_credentials';
  status: TrunkStatus;
}

export interface CreateTrunk {
  registrar: string;
  login: string;
  password: string;
  auth_mode: Trunk['auth_mode'];
}

export interface TrunkApi {
  list(): Promise<Trunk[]>;
  create(input: CreateTrunk): Promise<Trunk>;
  retry(id: string): Promise<Trunk>;
  remove(id: string): Promise<void>;
}
