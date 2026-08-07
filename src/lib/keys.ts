import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export const fetchGlobalKeys = async () => {
  try {
    const docRef = doc(db, 'settings', 'global');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().apiKeys) {
      return docSnap.data().apiKeys;
    }
  } catch (err) {
    console.debug("Skipped fetching global keys from cloud due to network or permissions.", err);
  }
  return JSON.parse(localStorage.getItem('greenops_byok_keys') || '{}');
};
