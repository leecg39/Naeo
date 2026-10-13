import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
export default async function Home(){const data=await getCapturedPage('/');return data?<PageExperience data={data}/>:null}
