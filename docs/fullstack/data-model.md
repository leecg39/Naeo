# 데이터 모델

모든 ID는 서버 생성 UUID, 시간은 UTC epoch milliseconds, 수정 가능한 자원은 version 정수로 낙관적 잠금을 적용한다. 사용자가 만든 자원은 owner_id FK를 가진다. 아래는 전체 구현 계약이다. 실제 적용된 테이블은 `src/server/migrations.ts`가 증거이며 계획의 표만으로 구현 완료로 세지 않는다.

| 도메인 | 테이블과 주요 필드 | 제약·삭제 정책 |
|---|---|---|
| 계정 | users(id,email,password_hash,role,status,created_at,updated_at), profiles(user_id,nickname,avatar_url,ranking_public,version), sessions(token_hash,user_id,expires_at) | email unique·정규화, 해시만 저장, 사용자 삭제 시 프로필·세션 cascade |
| 프로필 | contact_details(user_id,name,phone,email,phone_verified_at,version), notification_preferences(user_id,required_consent,marketing_consent,autoscan) | 검증 시간은 인증 서비스만 설정, 동의 이력 기록 |
| 연동 | oauth_accounts(provider,subject,user_id), oauth_clients(client_id,redirect_uris), oauth_grants(code_hash,user_id,client_id,scope,challenge,expires_at), api_tokens(token_hash,scope,user_id,expires_at) | provider+subject unique, code 일회 소모, user 삭제 cascade |
| 블로그 | blogs(id,owner_id,naver_id,title,category,is_primary,version), blog_posts(id,blog_id,external_id,url,title,content,published_at,collected_at) | owner+naver_id unique, 계정별 primary 하나, 주소 허용 목록, 게시물 출처 보존 |
| 분석 | scan_jobs(id,owner_id,blog_id,state,attempt,lease_until,progress,error,started_at,completed_at), scan_results(id,job_id,score,method_version,measured_at), citations(id,result_id,post_id,query,source_url,position,type), action_items(id,owner_id,result_id,title,status,version) | 상태 전이 검증, 작업 멱등 키 unique, 결과 원문 근거와 분석 버전 |
| 키워드 | keywords(id,phrase,category,status,version), keyword_metrics(keyword_id,measured_at,pc_volume,mobile_volume,document_count,source), recommendations(id,owner_id,keyword_id,reason), saved_keywords(id,owner_id,keyword_id,status,note,version) | phrase unique, 지표 음수 금지, owner+keyword unique |
| 경쟁자 | competitors(id,owner_id,blog_id,note,version) | owner+blog unique, 회원 한도 검증, 삭제 시 공유 수집 결과는 유지 가능 |
| 작성 | drafts(id,owner_id,title,keyword,body,status,version), draft_revisions(id,draft_id,version,body,title), generation_jobs(id,owner_id,draft_id,provider,state,cost,idempotency_key,error) | 상태 허용 목록, owner+idempotency unique, 수정 버전별 보존, 삭제 시 부속 이미지 처리 |
| 미디어 | media_assets(id,owner_id,draft_id,storage_key,mime,size,sha256,source), share_links(token_hash,owner_id,draft_id,expires_at,revoked_at) | 임의 경로 금지, 파일 크기/MIME 확인, 공유 철회 즉시 적용 |
| 콘텐츠 | content_pages(id,path,title,body,status,version), articles(id,category_id,slug,title,summary,body,status,published_at,version), article_categories(id,slug,name,sort_order), content_revisions(id,resource_type,resource_id,version,body), announcements(id,title,body,target,starts_at,ends_at,status,version) | URL/slug unique, draft/published/archived 구분, 기사 삭제/비공개 404, category 사용 시 삭제 거절 |
| 문의 | inquiries(id,owner_id?,email,type,subject,message,status,version), inquiry_messages(id,inquiry_id,author_id,body,created_at), inquiry_templates(id,name,subject,body,version) | 비회원은 생성 응답에 식별 토큰/개인 내용 노출 제한, 회원 본인/관리자만 RUD, 답변 이후 편집 제한 |
| 이벤트 | events(id,slug,title,body,starts_at,ends_at,rules,status,version), event_entries(id,event_id,owner_id,evidence,status,version), reward_claims(id,event_id,entry_id,owner_id,status,ledger_id) | event+owner unique, 기간/상태 전이, 보상 claim unique, 심사 후 수정은 재심사 |
| 랭킹 | ranking_periods(id,type,start_at,end_at,status), ranking_entries(id,period_id,blog_id,category,score,rank,metrics), champions(id,period_id,blog_id,category,score) | period+blog unique, 동점 규칙 명시, ranking_public 적용, 공개 기록에 개인 연락처 제외 |
| 결제 | plans(id,name,price,currency,limits,active,version), subscriptions(id,user_id,plan_id,status,trial_end,period_end,provider_id), payments(id,user_id,order_id,amount,status,provider_id), refunds(id,payment_id,amount,status), coupons(id,code,type,value,max_uses,expires_at,version), coupon_redemptions(id,coupon_id,user_id) | 금액 정수·음수 금지, order/provider unique, coupon+user unique, 서버 검증 후만 상태 변경 |
| 크레딧 | credit_ledger(id,user_id,kind,amount,reference,idempotency_key,created_at) | 변경/삭제 대신 반대 분개, 멱등 키 unique, 트랜잭션 내 잔액 검증, 유료 작업 실패 환급 |
| 제작 | creative_projects(id,owner_id,type,title,settings,version), creative_slides(id,project_id,position,body,assets,version), export_jobs(id,project_id,owner_id,format,state,file_id,error) | project+position unique, 순서 변경 transaction, 취소·출력 만료 |
| 운영 | audit_logs(id,actor_id?,action,entity_type,entity_id,metadata,created_at), rate_limits(key,count,reset_at), page_views(id,visitor_hash,path,attribution,created_at,dwell_ms) | 민감 정보/토큰 로그 제외, 감사 actor는 삭제 시 NULL, 체류 상한, rate limit 원자 갱신 |

약관·FAQ·가이드·업데이트는 content_pages의 유형별 편집 UI로 관리한다. 일정/계약/외부 응답처럼 구조가 유동적인 부가 설정만 JSON으로 저장하며 전체 CRUD를 하나의 JSON 저장 테이블로 대체하지 않는다.
