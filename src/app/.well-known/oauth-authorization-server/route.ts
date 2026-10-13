import {authorizationServerMetadata,metadataResponse} from '@/server/oauth/metadata';
export const dynamic='force-dynamic';
export function GET(){return metadataResponse(authorizationServerMetadata());}
