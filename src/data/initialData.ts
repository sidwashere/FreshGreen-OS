import { Brand, ContentItem } from '../types';

export const INITIAL_BRANDS: Brand[] = [
  {
    id: 'dtp-brand',
    name: "Daniel's Tasty Petfoods",
    slug: 'daniels-tasty-petfoods',
    wpUrl: 'https://danielstastypetfoods.co.uk',
    wpUsername: 'admin_dtp',
    wpAppPassword: 'xxxx xxxx xxxx xxxx',
    voiceGuidelines: 'Daniel\'s Tasty Petfoods — transparent nutrition, quality ingredients and the deep emotional bond between owners and pets. Educate first, be honest and confident, never sales-driven or fear-based. British English. Trust, integrity, kindness, practical solutions, quality before quantity. Never invent statistics or exaggerate benefits; where uncertainty exists, say so. Leave readers feeling "I can trust these people."',
    bannedWords: ['cheap', 'filler', 'artificial', 'junk', 'chemical'],
    primaryColor: '#10b981', // Emerald Green
    pageTemplates: ['default', 'elementor_canvas', 'elementor_header_footer'],
    defaultStatus: 'draft',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'organised-clean',
    name: 'Organised & Clean',
    slug: 'organised-and-clean',
    wpUrl: 'https://organisedandclean.co.uk',
    wpUsername: 'editor_clean',
    wpAppPassword: 'yyyy yyyy yyyy yyyy',
    voiceGuidelines: 'Organised and Clean — calm, reassuring, encouraging, never judgmental. Organisation supports wellbeing, reduces stress and brings pride and contentment. Speak with warmth, understanding and practical expertise; advice is always respectful, achievable and free from criticism. Celebrate progress rather than perfection. A comfortable home helps people live happier, healthier, less stressful lives.',
    bannedWords: ['cluttered', 'dirty', 'messy', 'overwhelming', 'harsh bleach'],
    primaryColor: '#06b6d4', // Cyan
    pageTemplates: ['default', 'elementor_canvas', 'elementor_header_footer'],
    defaultStatus: 'draft',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'home-at-peace',
    name: 'Home at Peace',
    slug: 'home-at-peace',
    wpUrl: 'https://homeatpeace.co.uk',
    wpUsername: 'care_manager',
    wpAppPassword: 'zzzz zzzz zzzz zzzz',
    voiceGuidelines: 'Home at Peace — compassionate, reassuring, deeply person-centred. Every individual deserves dignity, respect and genuine kindness. Communicate with warmth, empathy and quiet confidence; provide comfort, clarity and reassurance, never fear, pressure or guilt. Empower families with honest information, thoughtful guidance and practical support. Promote independence, choice and self-esteem. Professional excellence delivered with humanity.',
    bannedWords: ['stressful', 'alone', 'neglected', 'institutional'],
    primaryColor: '#8b5cf6', // Violet
    pageTemplates: ['default', 'elementor_canvas'],
    defaultStatus: 'draft',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'fresh-green-classics',
    name: 'Fresh Green Classics',
    slug: 'fresh-green-classics',
    wpUrl: 'https://freshgreenclassics.co.uk',
    wpUsername: 'carol_fgc',
    wpAppPassword: 'aaaa bbbb cccc dddd',
    voiceGuidelines: 'Fresh Green Classics — warm, imaginative, inspiring. Invite readers into a world of wonder, curiosity and discovery. Books shape young minds, strengthen family bonds and inspire a lifelong love of learning. Write with warmth, heart and authenticity; never talk down to children. Encourage questions, imagination and fresh eyes. Celebrate hope, friendship, courage and the simple joys of everyday life. Premium, trusted, timeless — like Penguin Books.',
    bannedWords: ['processed', 'synthetic', 'mass-produced'],
    primaryColor: '#059669', // Rich Emerald
    pageTemplates: ['default', 'elementor_canvas', 'elementor_header_footer'],
    defaultStatus: 'draft',
    createdAt: new Date().toISOString(),
  }
];

export const INITIAL_CONTENT: ContentItem[] = [
  {
    id: 'item-1',
    brandId: 'dtp-brand',
    title: 'The Ultimate Guide to Grain-Free Salmon Nutrition for Senior Dogs',
    slug: 'ultimate-guide-grain-free-salmon-senior-dogs',
    contentType: 'post',
    wpTemplate: 'default',
    status: 'Draft_Ready',
    primaryKeyword: 'grain free salmon dog food',
    secondaryKeywords: ['senior dog nutrition', 'omega 3 for dogs', 'sensitive stomach kibble'],
    seoBrief: 'Target senior dog owners looking for digestible protein that supports joint mobility and coat health without wheat fillers.',
    metaTitle: "Grain-Free Salmon Nutrition for Senior Dogs | Daniel's Tasty Petfoods",
    metaDescription: 'Discover why wild salmon, omega-3 fatty acids, and grain-free recipes support joint flexibility, shiny coats, and easy digestion in senior dogs.',
    bodyHtml: `
      <h2>Why Senior Dogs Thrive on Wild-Caught Salmon</h2>
      <p>As our beloved canine companions enter their golden years, their metabolic rate slows and joint cartilage naturally wears down. Wild-caught salmon provides a rich source of highly bioavailable protein, packed with EPA and DHA omega-3 fatty acids that help ease stiffness and maintain coat lustre.</p>
      
      <div class="my-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
        <h3 class="font-bold text-emerald-900 text-lg mb-2">💡 Quick Nutritional Takeaway</h3>
        <p class="text-emerald-800 text-sm">Unlike heavy grain-filled kibbles that can cause blood sugar spikes, salmon-based grain-free recipes maintain steady energy while putting minimal stress on ageing digestive tracts.</p>
      </div>

      <h2>Key Health Benefits of Our Grain-Free Recipe</h2>
      <ul>
        <li><strong>Joint Flexibility:</strong> Natural Omega-3s help soothe joint discomfort and keep senior dogs active.</li>
        <li><strong>Gentle Digestion:</strong> Zero wheat, corn, or soy—reducing flatulence and tummy sensitivities.</li>
        <li><strong>Brain & Eye Support:</strong> DHA nourishes cognitive health in mature dogs.</li>
      </ul>

      <h2>Frequently Asked Questions</h2>
      <details class="mb-2 p-3 bg-slate-50 rounded-lg">
        <summary class="font-semibold text-slate-800 cursor-pointer">Can I switch my senior dog to salmon food immediately?</summary>
        <p class="mt-2 text-slate-600 text-sm">We recommend a gradual 7-to-10 day transition, mixing increasing portions of salmon kibble with their current food.</p>
      </details>
    `,
    blocks: [
      {
        id: 'b-1',
        type: 'hero',
        title: 'Nourish Their Golden Years with Fresh Wild Salmon',
        subtitle: '100% Grain-Free, Hypoallergenic Senior Dog Formula',
        badge: 'Nutritional Care Guide',
        buttonText: 'Explore Senior Salmon Kibble',
        buttonUrl: 'https://daniels-tasty-petfoods.com/shop/senior-salmon',
        imageUrl: 'https://picsum.photos/seed/seniordog/1200/600',
        accentColor: '#10b981'
      },
      {
        id: 'b-2',
        type: 'paragraph',
        title: 'Understanding Your Senior Dog’s Evolving Needs',
        content: 'As our beloved canine companions enter their golden years, their metabolic rate slows and joint cartilage naturally wears down. Wild-caught salmon provides a rich source of highly bioavailable protein, packed with EPA and DHA omega-3 fatty acids that help ease stiffness and maintain coat lustre.'
      },
      {
        id: 'b-3',
        type: 'product_cta',
        title: 'Daniel’s Grain-Free Wild Salmon Senior Recipe',
        subtitle: 'Cold-pressed salmon oil + sweet potato + glucosamine',
        buttonText: 'Order Sample Bag (£4.99)',
        buttonUrl: 'https://daniels-tasty-petfoods.com/product/salmon-senior',
        imageUrl: 'https://picsum.photos/seed/kibblebag/600/600',
        accentColor: '#10b981'
      },
      {
        id: 'b-4',
        type: 'faq',
        title: 'Expert Senior Pet Care FAQ',
        faqItems: [
          {
            question: 'How does Omega-3 benefit joint health in older dogs?',
            answer: 'Omega-3 fatty acids help regulate joint inflammation, supporting comfortable daily walks and painless stair climbing.'
          },
          {
            question: 'Is this formula suitable for dogs with sensitive stomachs?',
            answer: 'Yes! By removing grains, artificial additives, and low-quality poultry, our salmon formula is extremely gentle on sensitive bellies.'
          }
        ]
      }
    ],
    nanoBananaPrompt: 'Senior Golden Retriever eating fresh salmon kibble, warm sunlight, cozy Scandinavian living room, 8k studio lighting',
    nanoBananaStyle: 'Photorealistic Studio Lighting',
    featuredImageUrl: 'https://picsum.photos/seed/seniordog/1200/800',
    wpPostId: 4102,
    wpPreviewUrl: 'https://daniels-tasty-petfoods.com/?p=4102&preview=true',
    wpLiveUrl: 'https://daniels-tasty-petfoods.com/ultimate-guide-grain-free-salmon-senior-dogs',
    lastSyncedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'item-2',
    brandId: 'organised-clean',
    title: 'The 15-Minute Scandi Morning Routine for a Clutter-Free Kitchen',
    slug: '15-minute-scandi-morning-routine-clutter-free-kitchen',
    contentType: 'page',
    wpTemplate: 'elementor_canvas',
    status: 'Draft_Ready',
    primaryKeyword: 'morning kitchen cleaning routine',
    secondaryKeywords: ['declutter kitchen counter', 'scandinavian cleaning tips', 'eco friendly kitchen spray'],
    seoBrief: 'Create a crisp, actionable guide for busy UK homeowners wanting a serene kitchen every morning without heavy chemical sprays.',
    metaTitle: '15-Minute Scandi Kitchen Morning Routine | Organised & Clean',
    metaDescription: 'Transform your morning kitchen habit in just 15 minutes. Simple Scandi decluttering tips, natural lemon micro-wipes, and peaceful countertop flow.',
    bodyHtml: `
      <h2>Start Every Morning in a Kitchen That Breathes Peace</h2>
      <p>In Nordic home culture, the kitchen countertop is considered an emotional workspace. Clearing it before your morning coffee sets a serene mental rhythm for the rest of your day.</p>
      
      <h3>The 3-Step Daily Reset</h3>
      <ol>
        <li><strong>Sink Empty & Wipe:</strong> Wash or load the night’s last mugs immediately.</li>
        <li><strong>Surface Micro-Mist:</strong> Lightly mist countertops with our plant-based citrus botanical spray.</li>
        <li><strong>Zonal Reset:</strong> Return small appliances to designated bamboo cupboards.</li>
      </ol>
    `,
    blocks: [
      {
        id: 'b-20',
        type: 'hero',
        title: 'The 15-Minute Scandi Kitchen Reset',
        subtitle: 'Bring Scandinavian calm and sparkling hygiene to your home every morning',
        badge: 'Minimalist Living Guide',
        buttonText: 'Download Printable Checklist',
        buttonUrl: '#',
        imageUrl: 'https://picsum.photos/seed/scandikitchen/1200/600',
        accentColor: '#06b6d4'
      }
    ],
    nanoBananaPrompt: 'Minimalist bright airy Scandinavian kitchen, sunbeams on clean marble counter, bamboo dish rack, natural high-key lighting',
    nanoBananaStyle: 'Bright Airy High-Key',
    featuredImageUrl: 'https://picsum.photos/seed/scandikitchen/1200/800',
    wpPostId: 108,
    wpPreviewUrl: 'https://organisedandclean.co.uk/?page_id=108&preview=true',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'item-3',
    brandId: 'home-at-peace',
    title: 'How Compassionate Home Support Restores Confidence in Elderly Relatives',
    slug: 'compassionate-home-support-restores-confidence-elderly',
    contentType: 'post',
    wpTemplate: 'default',
    status: 'Planned',
    primaryKeyword: 'elderly home support London',
    secondaryKeywords: ['compassionate elder care', 'dignified home assistance', 'family peace of mind'],
    seoBrief: 'Warm, reassuring article addressing adult children seeking respectful, dignified companionship and care for aging parents.',
    bodyHtml: '',
    blocks: [],
    nanoBananaPrompt: 'Warm cozy living room, senior lady laughing with gentle caregiver over tea, soft natural window light, empathetic atmosphere',
    nanoBananaStyle: 'Warm Empathetic Natural Light',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'item-4',
    brandId: 'fresh-green-classics',
    title: 'Seasonal Organic Spring Produce Guide & Artisan Table Pairings',
    slug: 'seasonal-organic-spring-produce-guide-artisan-pairings',
    contentType: 'post',
    wpTemplate: 'elementor_canvas',
    status: 'Published',
    primaryKeyword: 'organic spring produce guide',
    secondaryKeywords: ['seasonal eating UK', 'farm to table recipes', 'artisanal kitchen ingredients'],
    seoBrief: 'Celebrate seasonal UK spring crops like wild garlic, purple sprouting broccoli, and fresh radishes with farm-to-table recipe pairings.',
    metaTitle: 'Seasonal Organic Spring Produce Guide | Fresh Green Classics',
    metaDescription: 'Explore the richest organic UK spring harvests. Discover chef-selected recipes featuring wild garlic, heritage carrots, and fresh sourdough pairings.',
    bodyHtml: `
      <h2>The Joy of Spring Harvests</h2>
      <p>Spring brings a burst of crisp greens and tender roots to British organic farms. Incorporating seasonal produce ensures peak flavour, maximum vitamins, and low carbon footprint eating.</p>
    `,
    blocks: [],
    nanoBananaPrompt: 'Fresh organic green vegetables on rustic wooden table, wild garlic, heirloom carrots, rustic sunlight, macro detail 8k',
    nanoBananaStyle: 'Macro Rustic Food Photography',
    featuredImageUrl: 'https://picsum.photos/seed/organicveggies/1200/800',
    wpPostId: 882,
    wpPreviewUrl: 'https://freshgreenclassics.co.uk/?p=882&preview=true',
    wpLiveUrl: 'https://freshgreenclassics.co.uk/seasonal-organic-spring-produce-guide-artisan-pairings',
    lastSyncedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  }
];
