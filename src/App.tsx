import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ZenEditor } from './components/ZenEditor';
import { ContentHub } from './components/ContentHub';
import { BrandManager } from './components/BrandManager';
import { NanoBananaStudioModal } from './components/NanoBananaStudioModal';
import { WorkspaceHub } from './components/WorkspaceHub';
import { AutoBlogScheduler } from './components/AutoBlogScheduler';
import { SettingsTab } from './components/SettingsTab';
import { INITIAL_BRANDS, INITIAL_CONTENT } from './data/initialData';
import { Brand, ContentItem, PipelineStatus, AppUser } from './types';
import { initAuth, db } from './lib/firebase';
import { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

export default function App() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);

  const [selectedBrandId, setSelectedBrandId] = useState<string>('dtp-brand');
  const [activeTab, setActiveTab] = useState<string>('pipeline');
  const [activeItemId, setActiveItemId] = useState<string>('item-1');

  // Sidebar state: desktop collapse (persisted) + mobile drawer
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fgos_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fgos_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // ignore storage errors (private mode etc.)
      }
      return next;
    });
  };

  const navigateTab = (tab: string) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  };

  useEffect(() => {
    if (brands.length > 0 && selectedBrandId !== 'all' && !brands.find(b => b.id === selectedBrandId)) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId]);

  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Read the user's app_users profile and decide approved / pending / legacy
  const checkApproval = async (u: User): Promise<AppUser | null> => {
    const ref = doc(db, 'app_users', u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const profile = { id: u.uid, ...snap.data() } as AppUser;
      setAppUser(profile);
      return profile;
    }
    // Auto-authenticated account with no profile yet (fresh emulator first
    // run): provision it as the workspace ADMIN so the app is never locked
    // behind an approval screen. The owner auto-signs in as this account.
    const profile: AppUser = {
      id: u.uid,
      username: (u.email || 'user').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'user',
      role: 'admin',
      approved: true,
      createdAt: new Date().toISOString(),
      userId: u.uid,
    };
    try {
      await setDoc(ref, profile as any);
      await setDoc(doc(db, 'app_meta', 'bootstrap'), {
        initialized: true,
        adminUid: u.uid,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Could not provision the owner profile:', err);
    }
    setAppUser(profile);
    return profile;
  };

  const handleAuthUser = async (authUser: User) => {
    setUser(authUser);
    setAuthError(null);
    const profile = await checkApproval(authUser);
    if (!profile || !profile.approved) {
      setAuthError('Your account is not approved. Ask an administrator to approve it in Settings → User Management.');
    }
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser) => { handleAuthUser(authUser); },
      () => {
        setAuthError(
          'Automatic sign-in failed. Make sure the Firebase emulators are running (firestore :8080, auth :9099) and that the owner credentials in src/lib/firebase.ts match the seeded emulator.'
        );
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // One-time check for new user seeding
    const checkAndSeed = async () => {
      const storageKey = `fgos_seeded_${user.uid}`;
      if (localStorage.getItem(storageKey)) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists() || !userDoc.data().isSeeded) {
          // Mark as seeded first to avoid race conditions
          await setDoc(userDocRef, { isSeeded: true }, { merge: true });

          // Brand/content docs are scoped to the user (prefix the seed id with
          // the uid) so every account gets its own workspace copy — global ids
          // would collide: a second user's seed would be a denied update of the
          // first user's brand (ownership rules).
          const scope = (id: string) => `${user.uid}_${id}`;
          const scopedBrandIds = new Map<string, string>();

          for (const brand of INITIAL_BRANDS) {
            const brandId = scope(brand.id);
            scopedBrandIds.set(brand.id, brandId);
            await setDoc(doc(db, 'brands', brandId), { ...brand, id: brandId, userId: user.uid });
          }

          for (const item of INITIAL_CONTENT) {
            const itemId = scope(item.id);
            const brandId = scopedBrandIds.get(item.brandId) || scope(item.brandId);
            await setDoc(doc(db, 'content_items', itemId), { ...item, id: itemId, brandId, userId: user.uid });
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
      // Firestore rejects undefined field values ("invalid-argument"), and blocks
      // routinely contain them (imageLayout/author/cards/slides are only set for
      // their block type). Deep-strip undefined before persisting so autosaves
      // never die silently.
      const stripUndefined = (v: any): any => {
        if (Array.isArray(v)) return v.map(stripUndefined);
        if (v && typeof v === 'object') {
          const o: Record<string, any> = {};
          for (const [k, val] of Object.entries(v)) {
            if (val !== undefined) o[k] = stripUndefined(val);
          }
          return o;
        }
        return v;
      };
      await setDoc(doc(db, 'content_items', updatedItem.id), stripUndefined(itemToSave));
    } catch (err) {
      console.error('Failed to save content item', err);
    }
  };

  // Deletes an item from Firestore and trashes its WordPress post (if any).
  const handleDeleteItem = async (item: ContentItem): Promise<{ success: boolean; message?: string }> => {
    if (!user) return { success: false, message: 'Not signed in.' };
    try {
      if (item.wpPostId) {
        const brand = brands.find((b) => b.id === item.brandId);
        if (!brand) return { success: false, message: 'Could not find the brand connection for this item.' };
        try {
          const res = await fetch('/api/wp/delete-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brand, wpPostId: item.wpPostId, contentType: item.contentType }),
          });
          const data = await res.json();
          if (!data.success) {
            return { success: false, message: `WordPress: ${data.message || 'could not trash the post.'}` };
          }
        } catch (err: any) {
          return { success: false, message: `Could not reach WordPress: ${err.message}` };
        }
      }
      await deleteDoc(doc(db, 'content_items', item.id));
      return { success: true };
    } catch (err: any) {
      console.error('Failed to delete content item', err);
      return { success: false, message: err?.message || 'Failed to delete the item.' };
    }
  };

  const handleCreateNewItem = async (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[]; sheetContext?: any; seoBrief?: string; initialPrompt?: string }
  ) => {
    if (!user) return;
    const brand = brands.find((b) => b.id === brandId) || brands[0];
    const newItemId = `item-${Date.now()}`;
    const newItem: ContentItem & { userId: string } = {
      id: newItemId,
      userId: user.uid,
      brandId,
      title,
      // The seed title is the *brief* — it must not become the article's
      // headline (the theme renders the post title as an h1, so keeping the
      // seed out of the title prevents the recurring duplicate-header issue).
      initialPrompt: opts?.initialPrompt || title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      contentType,
      wpTemplate: brand?.pageTemplates?.[0] || 'default',
      status: 'Planned',
      primaryKeyword: opts?.primaryKeyword || title.split(' ').slice(0, 4).join(' '),
      secondaryKeywords: opts?.secondaryKeywords || [],
      seoBrief: opts?.seoBrief || 'Target audience interest and organic search ranking.',
      sheetContext: opts?.sheetContext || undefined,
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

  // Shared shape for importing a real WordPress post into the pipeline.
  // Used by the Dashboard's single-post import AND the Content Hub's bulk pull,
  // so both surfaces always mirror posts identically.
  const buildImportedWpItem = (post: any, brand: Brand): ContentItem & { userId: string } => {
    const now = new Date().toISOString();
    const link = post.link || '';
    return {
      id: `wp-item-${Date.now()}-${post.id}`,
      brandId: brand.id,
      title: post.title?.rendered || 'Imported Post',
      slug: post.slug || '',
      contentType: post.type === 'page' ? 'page' : 'post',
      wpTemplate: 'default',
      status: post.status === 'publish' ? 'Published' : 'Draft_Ready',
      primaryKeyword: '',
      secondaryKeywords: [],
      seoBrief: '',
      bodyHtml: post.content?.rendered || '',
      blocks: [],
      wpPostId: post.id,
      wpLiveUrl: post.status === 'publish' ? link : '',
      wpPreviewUrl: link ? `${link}${link.includes('?') ? '&' : '?'}preview=true` : '',
      createdAt: now,
      updatedAt: now,
      userId: user!.uid,
    };
  };

  const handleImportWPPost = async (post: any) => {
    if (!user) return;

    const brand = brands.find(b => b.id === post.brandId) || brands[0];
    if (!brand) return;

    // Check if we already have it
    let existingItem = items.find(i => i.wpPostId === post.id && i.brandId === brand.id);
    if (existingItem) {
      handleEditItem(existingItem);
      return;
    }

    const newItem = buildImportedWpItem(post, brand);

    try {
      await setDoc(doc(db, 'content_items', newItem.id), newItem);
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to import post', err);
    }
  };

  // Bulk import for the Content Hub: mirrors historic WordPress posts (drafts
  // and live ones) as pipeline items WITHOUT navigating — the hub stays put.
  const handleImportWPPosts = async (posts: any[], brand: Brand): Promise<number> => {
    if (!user) return 0;
    let imported = 0;
    for (const post of posts) {
      const existing = items.find((i) => i.wpPostId === post.id && i.brandId === brand.id);
      if (existing) continue;
      const newItem = buildImportedWpItem(post, brand);
      try {
        await setDoc(doc(db, 'content_items', newItem.id), newItem);
        imported++;
      } catch (err) {
        console.error('Failed to import post', err);
      }
    }
    return imported;
  };

  // Find active item & active brand.
  // The editor is brand-scoped: it always shows content for the selected brand,
  // so switching brands (navbar or elsewhere) switches the editor to that
  // brand's own drafts instead of staying pinned to a foreign item.
  const activeItem = useMemo(() => {
    if (activeTab !== 'editor') {
      return items.find((i) => i.id === activeItemId) || items[0] || null;
    }
    const open = items.find((i) => i.id === activeItemId);
    if (open && open.brandId === selectedBrandId) return open;
    const brandItems = items.filter((i) => i.brandId === selectedBrandId);
    if (brandItems.length === 0) return null;
    return [...brandItems].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )[0];
  }, [items, activeItemId, selectedBrandId, activeTab]);
  const activeBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];

  // Keep the editor's internal selection in sync with the selected brand:
  // switching brand while inside the editor jumps to that brand's newest item.
  useEffect(() => {
    if (activeTab !== 'editor') return;
    const open = items.find((i) => i.id === activeItemId);
    if (open && open.brandId === selectedBrandId) return;
    const brandItems = items.filter((i) => i.brandId === selectedBrandId);
    if (brandItems.length === 0) return; // editor shows the brand empty state
    const newest = [...brandItems].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )[0];
    setActiveItemId(newest.id);
  }, [selectedBrandId, activeTab, items, activeItemId]);

  const plannedCount = items.filter((i) => i.status === 'Planned' || i.status === 'Researching').length;
  const draftCount = items.filter((i) => i.status === 'Draft_Ready' || i.status === 'Generating').length;

  // No login screen: the app auto-authenticates as the workspace owner. While
  // that resolves, show a brief splash; if it ever fails (emulator down or
  // credentials changed), surface a clear error instead of a login form.
  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-sm w-full text-center space-y-5">
          <div className="w-14 h-14 bg-red-100 rounded-2xl mx-auto flex items-center justify-center">
            <span className="text-red-600 font-bold text-xl">!</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Could not sign in</h1>
            <p className="text-sm text-slate-500 mt-2">{authError}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 text-white font-semibold text-sm transition hover:bg-slate-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-[100dvh] bg-[#e9ecef] flex items-center justify-center font-sans">
        <div className="bg-white px-8 py-6 rounded-2xl shadow-sm border border-slate-200 flex items-center space-x-3">
          <span className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-slate-600">Signing you in automatically…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#e9ecef] flex p-0 md:p-4 font-sans antialiased text-slate-900 overflow-hidden">
      {/* App Shell Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#f4f6f8] md:rounded-[2rem] shadow-2xl border-0 md:border border-white/40 relative">
        {/* Mobile Sidebar Backdrop */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-30 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar: fixed drawer on mobile, static rail on desktop */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
            md:static md:translate-x-0 md:z-20 md:transition-none
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="h-full bg-white md:rounded-l-[2rem] shadow-2xl md:shadow-sm">
            <Sidebar
              activeTab={activeTab}
              onNavigateTab={navigateTab}
              plannedCount={plannedCount}
              draftCount={draftCount}
              contentCount={items.length}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
            />
          </div>
        </div>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 bg-transparent">
          {/* Top Navbar */}
          <Navbar
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={setSelectedBrandId}
            onOpenBrandModal={() => setActiveTab('brands')}
            onNavigateTab={navigateTab}
            activeTab={activeTab}
            onToggleSidebar={() => {
              if (window.innerWidth < 768) {
                setMobileSidebarOpen(true);
              } else {
                toggleSidebar();
              }
            }}
            sidebarCollapsed={sidebarCollapsed}
            currentUser={appUser}
          />

          {/* Workspace Content Area */}
          <main className="flex-1 overflow-y-auto bg-transparent p-2 md:p-4">
            {activeTab === 'pipeline' && (
              <Dashboard
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
                onCreateNewItem={handleCreateNewItem}
                onImportWPPost={handleImportWPPost}
              />
            )}

            {activeTab === 'editor' && (
              <ZenEditor
                item={activeItem}
                brand={activeItem ? brands.find((b) => b.id === activeItem.brandId) || activeBrand : activeBrand}
                onSaveItem={handleSaveItem}
                onSyncToWP={async (item) => {
                  handleSaveItem(item);
                }}
                onCreateNewItem={handleCreateNewItem}
              />
            )}

            {activeTab === 'nano-banana' && (
              <NanoBananaStudioModal brands={brands} selectedBrandId={selectedBrandId} />
            )}

            {activeTab === 'content-hub' && (
              <ContentHub
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                onEditItem={handleEditItem}
                onSaveItem={handleSaveItem}
                onCreateNewItem={handleCreateNewItem}
                onDeleteItem={handleDeleteItem}
                onImportWPPosts={handleImportWPPosts}
                onNavigateTab={navigateTab}
              />
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

            {activeTab === 'autoblog' && (
              <AutoBlogScheduler
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSaveItem={handleSaveItem}
                onCreateNewItem={handleCreateNewItem}
                onDeleteItem={handleDeleteItem}
                onEditItem={handleEditItem}
              />
            )}

            {activeTab === 'workspace' && <WorkspaceHub />}

            {activeTab === 'settings' && (
            <SettingsTab
              brands={brands}
              selectedBrandId={selectedBrandId}
              currentUser={appUser}
            />
          )}
          </main>
        </div>
      </div>
    </div>
  );
}
