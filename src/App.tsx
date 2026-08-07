import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ZenEditor } from './components/ZenEditor';
import { BrandManager } from './components/BrandManager';
import { NanoBananaStudioModal } from './components/NanoBananaStudioModal';
import { WorkspaceHub } from './components/WorkspaceHub';
import { SettingsTab } from './components/SettingsTab';
import { INITIAL_BRANDS, INITIAL_CONTENT } from './data/initialData';
import { Brand, ContentItem, PipelineStatus } from './types';
import { initAuth, googleSignIn, db } from './lib/firebase';
import { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

export default function App() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);

  const [selectedBrandId, setSelectedBrandId] = useState<string>('dtp-brand');
  const [activeTab, setActiveTab] = useState<string>('pipeline');
  const [activeItemId, setActiveItemId] = useState<string>('item-1');

  useEffect(() => {
    if (brands.length > 0 && !brands.find(b => b.id === selectedBrandId)) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId]);

  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser) => {
        setUser(authUser);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
        setBrands([]);
        setItems([]);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // One-time check for new user seeding
    const checkAndSeed = async () => {
      const storageKey = `greenops_seeded_${user.uid}`;
      if (localStorage.getItem(storageKey)) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists() || !userDoc.data().isSeeded) {
          // Mark as seeded first to avoid race conditions
          await setDoc(userDocRef, { isSeeded: true }, { merge: true });
          
          for (const brand of INITIAL_BRANDS) {
            await setDoc(doc(db, 'brands', brand.id), { ...brand, userId: user.uid });
          }
          
          for (const item of INITIAL_CONTENT) {
            await setDoc(doc(db, 'content_items', item.id), { ...item, userId: user.uid });
          }
        }
        localStorage.setItem(storageKey, 'true');
      } catch (err) {
        // Silently handle offline or permission errors during initial seed check
        console.debug("Skipped seeding check due to network or permissions.");
      }
    };
    
    checkAndSeed();

    const qBrands = query(collection(db, 'brands'), where('userId', '==', user.uid));
    const unsubscribeBrands = onSnapshot(qBrands, (snapshot) => {
      const fbBrands = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
      setBrands(fbBrands);
    }, (error) => {
      console.error("Error fetching brands snapshot:", error);
    });

    const qItems = query(collection(db, 'content_items'), where('userId', '==', user.uid));
    const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
      const fbItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ContentItem));
      setItems(fbItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      console.error("Error fetching items snapshot:", error);
    });

    return () => {
      unsubscribeBrands();
      unsubscribeItems();
    };
  }, [user]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Brand Management Actions
  const handleSaveBrand = async (updatedBrand: Brand) => {
    if (!user) return;
    try {
      const brandToSave = { ...updatedBrand, userId: user.uid };
      await setDoc(doc(db, 'brands', updatedBrand.id), brandToSave);
    } catch (err) {
      console.error('Failed to save brand', err);
    }
  };

  const handleDeleteBrand = async (brandId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'brands', brandId));
    } catch (err) {
      console.error('Failed to delete brand', err);
    }
  };

  // Content Item Actions
  const handleSaveItem = async (updatedItem: ContentItem) => {
    if (!user) return;
    try {
      const itemToSave = { ...updatedItem, userId: user.uid };
      await setDoc(doc(db, 'content_items', updatedItem.id), itemToSave);
    } catch (err) {
      console.error('Failed to save content item', err);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'content_items', itemId));
    } catch (err) {
      console.error('Failed to delete content item', err);
    }
  };

  const handleCreateNewItem = async (title: string, brandId: string, contentType: 'post' | 'page') => {
    if (!user) return;
    const brand = brands.find((b) => b.id === brandId) || brands[0];
    const newItemId = `item-${Date.now()}`;
    const newItem: ContentItem & { userId: string } = {
      id: newItemId,
      userId: user.uid,
      brandId,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      contentType,
      wpTemplate: brand?.pageTemplates?.[0] || 'default',
      status: 'Planned',
      primaryKeyword: title.split(' ').slice(0, 4).join(' '),
      secondaryKeywords: [],
      seoBrief: 'Target audience interest and organic search ranking.',
      bodyHtml: `<h2>${title}</h2><p>Article introduction content generated for ${brand?.name || 'Brand'}.</p>`,
      blocks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'content_items', newItemId), newItem);
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to create new content item', err);
    }
  };

  const handleUpdateStatus = async (itemId: string, status: PipelineStatus) => {
    if (!user) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    try {
      const updatedItem = { ...item, status, updatedAt: new Date().toISOString(), userId: user.uid };
      await setDoc(doc(db, 'content_items', itemId), updatedItem);
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const handleEditItem = (item: ContentItem) => {
    setActiveItemId(item.id);
    setSelectedBrandId(item.brandId);
    setActiveTab('editor');
  };

  const handleImportWPPost = async (post: any) => {
    if (!user) return;
    
    const brand = brands.find(b => b.id === post.brandId) || brands[0];
    
    // Check if we already have it
    let existingItem = items.find(i => (i as any).wpPostId === post.id && i.brandId === brand.id);
    if (existingItem) {
      handleEditItem(existingItem);
      return;
    }
    
    const newItemId = 'wp-item-' + Date.now();
    const newItem: any = {
      id: newItemId,
      brandId: brand.id,
      title: post.title?.rendered || 'Imported Post',
      slug: post.slug || '',
      contentType: post.type === 'page' ? 'page' : 'post',
      wpTemplate: 'default',
      status: 'Published', // Since it came from live WP
      primaryKeyword: '',
      secondaryKeywords: [],
      seoBrief: '',
      bodyHtml: post.content?.rendered || '',
      blocks: [],
      wpPostId: post.id,
      wpLiveUrl: post.link,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: user.uid,
    };
    
    try {
      await setDoc(doc(db, 'content_items', newItemId), newItem);
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to import post', err);
    }
  };

  // Find active item & active brand
  const activeItem = items.find((i) => i.id === activeItemId) || items[0];
  const activeBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];

  const plannedCount = items.filter((i) => i.status === 'Planned' || i.status === 'Researching').length;
  const draftCount = items.filter((i) => i.status === 'Draft_Ready' || i.status === 'Generating').length;

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-sm w-full text-center space-y-6">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl mx-auto flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-xl">G</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Welcome to FreshGreenOps Studio</h1>
            <p className="text-sm text-slate-500 mt-2">Please sign in with your Google account to access Workspace integrations.</p>
          </div>
          
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium py-2.5 px-4 rounded-lg flex items-center justify-center space-x-2 transition"
          >
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
            <span>{isLoggingIn ? 'Signing in...' : 'Sign in with Google'}</span>
          </button>
          
          <div className="text-[11px] text-slate-400 mt-4 leading-relaxed bg-slate-50 p-3 rounded-lg text-left">
            <strong>Note:</strong> If the sign-in popup gets blocked or fails to open, please open this application in a <strong>New Tab</strong> using the button in the top right corner of the AI Studio preview window.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e9ecef] flex p-2 md:p-4 font-sans antialiased text-slate-900 overflow-hidden">
      {/* App Shell Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#f4f6f8] rounded-[2rem] shadow-2xl border border-white/40 relative">
        {/* Left Sidebar */}
        <div className="bg-white rounded-l-[2rem] shadow-sm z-20">
          <Sidebar
            activeTab={activeTab}
            onNavigateTab={setActiveTab}
            plannedCount={plannedCount}
            draftCount={draftCount}
          />
        </div>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 bg-transparent">
          {/* Top Navbar */}
          <Navbar
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={setSelectedBrandId}
            onOpenBrandModal={() => setActiveTab('brands')}
            onNavigateTab={setActiveTab}
            activeTab={activeTab}
          />

          {/* Workspace Content Area */}
          <main className="flex-1 overflow-y-auto bg-transparent p-2">
            {activeTab === 'pipeline' && (
              <Dashboard
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                onEditItem={handleEditItem}
                onCreateNewItem={handleCreateNewItem}
                onImportWPPost={handleImportWPPost}
              />
            )}

            {activeTab === 'editor' && activeItem && (
              <ZenEditor
                item={activeItem}
                brand={brands.find((b) => b.id === activeItem.brandId) || activeBrand}
                onSaveItem={handleSaveItem}
                onSyncToWP={async (item) => {
                  handleSaveItem(item);
                }}
              />
            )}

            {activeTab === 'nano-banana' && (
              <NanoBananaStudioModal brands={brands} selectedBrandId={selectedBrandId} />
            )}

            {activeTab === 'brands' && (
              <BrandManager
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSaveBrand={handleSaveBrand}
                onDeleteBrand={handleDeleteBrand}
                onSelectBrand={setSelectedBrandId}
              />
            )}

            {activeTab === 'workspace' && <WorkspaceHub />}

            {activeTab === 'settings' && (
            <SettingsTab
              brands={brands}
              selectedBrandId={selectedBrandId}
            />
          )}
          </main>
        </div>
      </div>
    </div>
  );
}
