import { Redirect } from 'expo-router';
import { useSession } from '../src/store/session';

export default function Index() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  return <Redirect href={signedIn ? '/home' : '/welcome'} />;
}
