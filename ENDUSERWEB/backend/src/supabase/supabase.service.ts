import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client!: SupabaseClient;
  private damayanClient!: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // BayaniHub DB (primary)
    const url = this.config.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    this.client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Damayan DB (external disaster management)
    const damayanUrl = this.config.getOrThrow<string>('DAMAYAN_SUPABASE_URL');
    const damayanKey = this.config.getOrThrow<string>('DAMAYAN_SERVICE_ROLE_KEY');

    this.damayanClient = createClient(damayanUrl, damayanKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('Connected to BayaniHub DB and Damayan DB');
    
    // Ensure storage buckets exist
    this.initializeBuckets();
  }

  private async initializeBuckets() {
    const required = ['volunteer-documents', 'identity-documents'];
    try {
      const { data: buckets, error } = await this.client.storage.listBuckets();
      if (error) throw error;

      for (const bucketName of required) {
        if (!buckets.find(b => b.name === bucketName)) {
          this.logger.log(`Storage Bucket "${bucketName}" missing. Creating...`);
          const { error: createError } = await this.client.storage.createBucket(bucketName, {
            public: true,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            fileSizeLimit: 10 * 1024 * 1024 // 10MB
          });
          if (createError) {
            this.logger.error(`Failed to create bucket "${bucketName}": ${createError.message}`);
          } else {
            this.logger.log(`Storage Bucket "${bucketName}" created successfully.`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Initial bucket check failed (possibly insufficient permissions): ${err.message}`);
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getDamayanClient(): SupabaseClient {
    return this.damayanClient;
  }

  getAnonKey(): string {
    return this.config.getOrThrow<string>('SUPABASE_ANON_KEY');
  }

  getUrl(): string {
    return this.config.getOrThrow<string>('SUPABASE_URL');
  }

  // --- BAYANIHUB WORKFLOW INSERTS ---

  async insertVolunteerApplication(data: any, volunteerAuthId: string, file?: Express.Multer.File) {
    const { role, center_id, campaign_id, center_name } = data;
    
    // Determine the ID and a human-readable name
    const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    
    const validCampaignId = isUUID(center_id) ? center_id : (isUUID(campaign_id) ? campaign_id : null);
    const displayName = center_name || (validCampaignId ? 'In-Progress Selection' : 'N/A');

    if (!validCampaignId && !center_name) {
      throw new Error("Missing site location or campaign identifier.");
    }

    if (!role) {
      throw new Error("Missing selected role in application payload.");
    }

    // 1. Resolve role_id (scoped to campaign if ID is available)
    let query = this.client
      .from('volunteer_roles')
      .select('id')
      .ilike('title', role);
      
    if (validCampaignId) {
      query = query.eq('campaign_id', validCampaignId);
    }

    let { data: roles } = await query.limit(1);

    let roleId;
    if (!roles || roles.length === 0) {
      const { data: newRole, error: roleErr } = await this.client
        .from('volunteer_roles')
        .insert([{
          title: role,
          campaign_id: validCampaignId, // Will be null if no valid UUID
          status: 'open',
          slots_total: 10
        }]).select('id').single();
      if (roleErr) throw new Error(`Role Creation Error: ${roleErr.message}`);
      roleId = newRole.id;
    } else {
      roleId = roles[0].id;
    }

    // 2. Upload Document
    let resumeKey = null;
    if (file) {
      resumeKey = await this.uploadFile(file, 'resumes');
    }

    // 3. Condense Questionnaire Data
    const motivationStr = `Questionnaire Assessment:
- Site/Campaign: ${displayName} (${validCampaignId || 'No UUID Mapping'})
- Disaster Experience: ${data.disaster_experience === 'true' || data.disaster_experience === true ? 'Yes' : 'No'}
- Rugged Environment Comfort: ${data.rugged_environment === 'true' || data.rugged_environment === true ? 'Yes' : 'No'}
- Medical Conditions/Restrictions: ${data.medical_conditions === 'true' || data.medical_conditions === true ? 'Yes' : 'No'}
- Vaccinations Current: ${data.vaccinations_current === 'true' || data.vaccinations_current === true ? 'Yes' : 'No'}
- Can Lift 25lbs: ${data.can_lift_25lbs === 'true' || data.can_lift_25lbs === true ? 'Yes' : 'No'}
- Transportation: ${data.has_transportation === 'true' || data.has_transportation === true ? 'Yes' : 'No'} (${data.transportation_mode || 'N/A'})
- Background Check Agreed: ${data.background_check_agreed === 'true' || data.background_check_agreed === true ? 'Yes' : 'No'}
- Required Documents Provided: ${data.documents_agreed === 'true' || data.documents_agreed === true ? 'Yes' : 'No'}
- Over 18: ${data.age_verified === 'true' || data.age_verified === true ? 'Yes' : 'No'}
- Code of Conduct / Safety Agreed: Yes`;

    // 4. Insert Application
    const applicationPayload = {
      role_id: roleId,
      volunteer_auth_id: volunteerAuthId,
      motivation: motivationStr,
      skills: [role || 'Volunteer'],
      availability: data.time_slot,
      resume_key: resumeKey,
      status: 'submitted'
    };

    console.log('Inserting Volunteer Application:', applicationPayload);

    const { data: result, error } = await this.client
      .from('volunteer_applications')
      .insert([applicationPayload])
      .select();
      
    if (error) {
      this.logger.error(`Supabase Volunteer Error: ${error.message} (Code: ${error.code})`);
      this.logger.error(`Failed Payload: ${JSON.stringify(applicationPayload)}`);
      throw new Error(`Supabase Error: ${error.message}`);
    }
    return result;
  }

  async getLatestApplication(userId: string) {
    const { data, error } = await this.client
      .from('volunteer_applications')
      .select('*, volunteer_roles(*)')
      .eq('volunteer_auth_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      this.logger.error(`Error fetching application for user ${userId}: ${error.message}`);
      throw new Error(`Supabase Error: ${error.message}`);
    }
    
    return data;
  }

  async getVolunteerCampaigns() {
    // Fetch open evacuation centers from Damayan DB
    const { data: result, error } = await this.damayanClient
      .from('evacuation_centers')
      .select('id, name, municipality, barangay, status, capacity, current_occupancy')
      .eq('status', 'open');
      
    if (error) throw new Error(`Damayan DB Error: ${error.message}`);
    return result;
  }

  async getActiveCampaigns() {
    // Fetch ongoing relief operations from Damayan DB
    const { data: result, error } = await this.damayanClient
      .from('relief_operations')
      .select('id, name, description, status')
      .eq('status', 'ongoing');
      
    if (error) throw new Error(`Damayan DB Error: ${error.message}`);
    return result;
  }

  async insertDonation(donationData: any, donorAuthId: string) {
    const { campaign_id, center_id, center_name, items } = donationData;
    const finalCampaignId = campaign_id || center_id || center_name;
    
    if (!items || !Array.isArray(items)) {
      throw new Error("Invalid donation payload. Missing items array.");
    }

    const rows = items.map((item: any) => ({
      campaign_id: finalCampaignId,
      donor_auth_id: donorAuthId,
      status: 'pending',
      item_name: item.name,
      // Handle both qty (mobile) and quantity (web)
      quantity: parseInt(item.qty || item.quantity, 10) || 1,
      unit: (item.unit || 'pieces').toLowerCase(),
      condition: (item.condition || 'good').toLowerCase().replace(/\s+|-/g, '_'),
    }));

    const { data: result, error } = await this.client
      .from('donations')
      .insert(rows)
      .select();
      
    if (error) {
      this.logger.error(`Supabase Donation Error: ${error.message}`);
      throw new Error(`Supabase Error: ${error.message}`);
    }
    return result;
  }

  private async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const BUCKET = 'volunteer-documents';
    const filePath = `${folder}/${Date.now()}-${file.originalname}`;

    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      throw new Error(`File upload error: ${uploadError.message}`);
    }

    const { data: urlData } = this.client.storage.from(BUCKET).getPublicUrl(filePath);
    return urlData.publicUrl;
  }
}
