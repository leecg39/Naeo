import Link from 'next/link';
import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listUsers,listAudit} from '@/server/admin-users';
import AdminShell from '@/components/admin/AdminShell';
import AuditLog,{type AuditRow} from '@/components/admin/AuditLog';
import type {PageResult} from '@/lib/api-client';
import OpsOverview from '@/components/admin/OpsOverview';
import {analyticsSummary} from '@/server/ops/analytics';
import {serviceHealth} from '@/server/ops/health';
import type {Database} from '@/server/database';
/** 운영 지표는 요청 시각 기준으로 읽는다. */
const ops=(db:Database,id:string)=>({summary:analyticsSummary(db,id,{days:7}),health:serviceHealth(db,id)});
export const dynamic='force-dynamic';
export default async function AdminPage(){const user=await adminPageUser('/admin'),db=database(),users=listUsers(db,user.id,{pageSize:1});return <AdminShell title="운영 현황" path="/admin"><div className="settings-sections"><section className="panel account-card"><h2>사용자 {users.pagination.total}명</h2><p className="muted">계정 생성·권한·이용 상태와 관리 작업을 확인하세요.</p><Link className="button" href="/admin/users">사용자 관리</Link></section><OpsOverview {...ops(db,user.id)}/><AuditLog initial={listAudit(db,user.id,{}) as PageResult<AuditRow>}/></div></AdminShell>;}
