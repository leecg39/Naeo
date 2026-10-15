import {contentDatabase} from '@/server/content/public-pages';
import {activeAnnouncements} from '@/server/content/announcements';
import AnnouncementQueue from './AnnouncementQueue';

/** 회원 화면에서는 pageUser 인증을 마친 페이지가 이 컴포넌트를 렌더링한다. */
export default function PageAnnouncements({path}:{path:string}){
 return <AnnouncementQueue announcements={activeAnnouncements(contentDatabase(),path)}/>;
}
