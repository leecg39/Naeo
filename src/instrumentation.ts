/**
 * 웹 서버 안에서 잡 처리자를 돌린다. 별도 `npm run worker` 프로세스 없이도
 * 스캔·인용 확인·AI 생성·메일·내보내기가 진행된다. lease로 외부 워커와
 * 중복 실행을 막는다. 끄려면 NAEO_INPROCESS_WORKER=0.
 */
export async function register(){
 if(process.env.NEXT_RUNTIME!=='nodejs')return;
 if(process.env.NAEO_INPROCESS_WORKER==='0')return;
 const {startInProcessWorker}=await import('./server/jobs/inprocess');
 startInProcessWorker();
}
