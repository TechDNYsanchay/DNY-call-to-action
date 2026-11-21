export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          confidence: number | null
          created_at: string
          details: string
          done_at: string | null
          done_by: string | null
          due_date: string | null
          due_kind: string | null
          due_phrase: string | null
          edited_at: string | null
          edited_by: string | null
          erp_sync_status: Database["public"]["Enums"]["sync_status"]
          erp_task_id: string | null
          evidence_quote: string | null
          evidence_speaker: string | null
          evidence_ts_sec: number | null
          evidence_verified: boolean
          id: string
          item_key: string
          linked_decision: string | null
          meeting_id: string
          owed_by: Database["public"]["Enums"]["owner_side"]
          owner_basis: string | null
          owner_email: string | null
          owner_name: string | null
          position: number
          priority: Database["public"]["Enums"]["priority"]
          sheet_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          details?: string
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          due_kind?: string | null
          due_phrase?: string | null
          edited_at?: string | null
          edited_by?: string | null
          erp_sync_status?: Database["public"]["Enums"]["sync_status"]
          erp_task_id?: string | null
          evidence_quote?: string | null
          evidence_speaker?: string | null
          evidence_ts_sec?: number | null
          evidence_verified?: boolean
          id?: string
          item_key: string
          linked_decision?: string | null
          meeting_id: string
          owed_by?: Database["public"]["Enums"]["owner_side"]
          owner_basis?: string | null
          owner_email?: string | null
          owner_name?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["priority"]
          sheet_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          details?: string
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          due_kind?: string | null
          due_phrase?: string | null
          edited_at?: string | null
          edited_by?: string | null
          erp_sync_status?: Database["public"]["Enums"]["sync_status"]
          erp_task_id?: string | null
          evidence_quote?: string | null
          evidence_speaker?: string | null
          evidence_ts_sec?: number | null
          evidence_verified?: boolean
          id?: string
          item_key?: string
          linked_decision?: string | null
          meeting_id?: string
          owed_by?: Database["public"]["Enums"]["owner_side"]
          owner_basis?: string | null
          owner_email?: string | null
          owner_name?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["priority"]
          sheet_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          attempt: number
          created_at: string
          errors: Json | null
          id: string
          kind: string
          meeting_id: string
          status: string
          summary: string | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          errors?: Json | null
          id?: string
          kind: string
          meeting_id: string
          status: string
          summary?: string | null
        }
        Update: {
          attempt?: number
          created_at?: string
          errors?: Json | null
          id?: string
          kind?: string
          meeting_id?: string
          status?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      call_log: {
        Row: {
          attempts: number
          bytes: number | null
          call_started_at: string
          callyzer_id: string
          counterpart_e164: string | null
          counterpart_masked: string
          counterpart_name: string | null
          direction: string
          duration_sec: number
          error: string | null
          error_kind: string | null
          first_error_at: string | null
          first_seen_at: string
          line_id: string
          meeting_id: string | null
          next_try_at: string | null
          recording_seen_at: string | null
          recording_url: string | null
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          bytes?: number | null
          call_started_at: string
          callyzer_id: string
          counterpart_e164?: string | null
          counterpart_masked: string
          counterpart_name?: string | null
          direction: string
          duration_sec: number
          error?: string | null
          error_kind?: string | null
          first_error_at?: string | null
          first_seen_at?: string
          line_id: string
          meeting_id?: string | null
          next_try_at?: string | null
          recording_seen_at?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          bytes?: number | null
          call_started_at?: string
          callyzer_id?: string
          counterpart_e164?: string | null
          counterpart_masked?: string
          counterpart_name?: string | null
          direction?: string
          duration_sec?: number
          error?: string | null
          error_kind?: string | null
          first_error_at?: string | null
          first_seen_at?: string
          line_id?: string
          meeting_id?: string | null
          next_try_at?: string | null
          recording_seen_at?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_log_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "phone_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_log_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      call_reread_requests: {
        Row: {
          day: string
          done_at: string | null
          requested_at: string
          requested_by: string | null
        }
        Insert: {
          day: string
          done_at?: string | null
          requested_at?: string
          requested_by?: string | null
        }
        Update: {
          day?: string
          done_at?: string | null
          requested_at?: string
          requested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_reread_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      call_stt_usage: {
        Row: {
          created_at: string
          id: number
          meeting_id: string | null
          outcome: string
          reserved_sec: number
        }
        Insert: {
          created_at?: string
          id?: never
          meeting_id?: string | null
          outcome?: string
          reserved_sec: number
        }
        Update: {
          created_at?: string
          id?: never
          meeting_id?: string | null
          outcome?: string
          reserved_sec?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_stt_usage_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      call_transcripts: {
        Row: {
          fetched_at: string
          meeting_id: string
          sentence_count: number
          turns: Json
          word_count: number
        }
        Insert: {
          fetched_at?: string
          meeting_id: string
          sentence_count?: number
          turns: Json
          word_count?: number
        }
        Update: {
          fetched_at?: string
          meeting_id?: string
          sentence_count?: number
          turns?: Json
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_feedback: {
        Row: {
          client_id: string | null
          created_at: string
          from_type: Database["public"]["Enums"]["meeting_type"]
          id: string
          meeting_id: string
          note: string | null
          person_id: string | null
          to_type: Database["public"]["Enums"]["meeting_type"]
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          from_type: Database["public"]["Enums"]["meeting_type"]
          id?: string
          meeting_id: string
          note?: string | null
          person_id?: string | null
          to_type: Database["public"]["Enums"]["meeting_type"]
        }
        Update: {
          client_id?: string | null
          created_at?: string
          from_type?: Database["public"]["Enums"]["meeting_type"]
          id?: string
          meeting_id?: string
          note?: string | null
          person_id?: string | null
          to_type?: Database["public"]["Enums"]["meeting_type"]
        }
        Relationships: [
          {
            foreignKeyName: "classification_feedback_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      client_meeting_bookings: {
        Row: {
          attendee_ids: string[]
          booked_by: string | null
          calendar_event_id: string | null
          cancelled_at: string | null
          client_emails: string[]
          client_id: string | null
          client_name: string
          created_at: string
          duration_min: number
          id: string
          meet_code: string | null
          meet_url: string | null
          meeting_id: string | null
          notes: string | null
          starts_at: string
          status: string
        }
        Insert: {
          attendee_ids?: string[]
          booked_by?: string | null
          calendar_event_id?: string | null
          cancelled_at?: string | null
          client_emails: string[]
          client_id?: string | null
          client_name: string
          created_at?: string
          duration_min: number
          id?: string
          meet_code?: string | null
          meet_url?: string | null
          meeting_id?: string | null
          notes?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          attendee_ids?: string[]
          booked_by?: string | null
          calendar_event_id?: string | null
          cancelled_at?: string | null
          client_emails?: string[]
          client_id?: string | null
          client_name?: string
          created_at?: string
          duration_min?: number
          id?: string
          meet_code?: string | null
          meet_url?: string | null
          meeting_id?: string | null
          notes?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_meeting_bookings_booked_by_fkey"
            columns: ["booked_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_meeting_bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_meeting_bookings_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_emails: string[]
          created_at: string
          domains: string[]
          erp_client_id: string | null
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_emails?: string[]
          created_at?: string
          domains?: string[]
          erp_client_id?: string | null
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_emails?: string[]
          created_at?: string
          domains?: string[]
          erp_client_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_connection: {
        Row: {
          connected_at: string
          connected_by: string | null
          email: string
          id: boolean
          refresh_token: string
          scopes: string[]
        }
        Insert: {
          connected_at?: string
          connected_by?: string | null
          email: string
          id?: boolean
          refresh_token: string
          scopes?: string[]
        }
        Update: {
          connected_at?: string
          connected_by?: string | null
          email?: string
          id?: boolean
          refresh_token?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "google_connection_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      item_feedback: {
        Row: {
          action_item_id: string
          created_at: string
          edited: Json | null
          id: string
          person_id: string | null
          reason_code: string | null
          verdict: string
        }
        Insert: {
          action_item_id: string
          created_at?: string
          edited?: Json | null
          id?: string
          person_id?: string | null
          reason_code?: string | null
          verdict: string
        }
        Update: {
          action_item_id?: string
          created_at?: string
          edited?: Json | null
          id?: string
          person_id?: string | null
          reason_code?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_feedback_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_feedback_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          callyzer_call_id: string | null
          claim_token: string | null
          claimed_at: string | null
          client_id: string | null
          client_name_guess: string | null
          created_at: string
          duration_sec: number
          failure_reason: string | null
          happened_at: string
          id: string
          kind: string
          meet_code: string | null
          organizer_email: string | null
          organizer_name: string | null
          process_attempts: number
          process_status: Database["public"]["Enums"]["process_status"]
          raw: Json | null
          source: string
          title: string | null
          tldv_meeting_id: string | null
          tldv_url: string | null
          transcript_ready: boolean
          type: Database["public"]["Enums"]["meeting_type"]
          type_confidence: number | null
          type_reason: string | null
          type_source: Database["public"]["Enums"]["type_source"] | null
          updated_at: string
        }
        Insert: {
          callyzer_call_id?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          client_id?: string | null
          client_name_guess?: string | null
          created_at?: string
          duration_sec?: number
          failure_reason?: string | null
          happened_at: string
          id?: string
          kind?: string
          meet_code?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          process_attempts?: number
          process_status?: Database["public"]["Enums"]["process_status"]
          raw?: Json | null
          source?: string
          title?: string | null
          tldv_meeting_id?: string | null
          tldv_url?: string | null
          transcript_ready?: boolean
          type?: Database["public"]["Enums"]["meeting_type"]
          type_confidence?: number | null
          type_reason?: string | null
          type_source?: Database["public"]["Enums"]["type_source"] | null
          updated_at?: string
        }
        Update: {
          callyzer_call_id?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          client_id?: string | null
          client_name_guess?: string | null
          created_at?: string
          duration_sec?: number
          failure_reason?: string | null
          happened_at?: string
          id?: string
          kind?: string
          meet_code?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          process_attempts?: number
          process_status?: Database["public"]["Enums"]["process_status"]
          raw?: Json | null
          source?: string
          title?: string | null
          tldv_meeting_id?: string | null
          tldv_url?: string | null
          transcript_ready?: boolean
          type?: Database["public"]["Enums"]["meeting_type"]
          type_confidence?: number | null
          type_reason?: string | null
          type_source?: Database["public"]["Enums"]["type_source"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          provider_id: string | null
          recipient: string
          sent_at: string | null
          sheet_id: string
          status: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          provider_id?: string | null
          recipient: string
          sent_at?: string | null
          sheet_id: string
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          provider_id?: string | null
          recipient?: string
          sent_at?: string | null
          sheet_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          domain: string | null
          email: string
          is_dny: boolean
          is_organizer: boolean
          meeting_id: string
          name: string | null
        }
        Insert: {
          domain?: string | null
          email: string
          is_dny?: boolean
          is_organizer?: boolean
          meeting_id: string
          name?: string | null
        }
        Update: {
          domain?: string | null
          email?: string
          is_dny?: boolean
          is_organizer?: boolean
          meeting_id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string
          dept: string | null
          email: string
          email_notifications: boolean
          erp_user_id: string | null
          full_name: string
          id: string
          role: Database["public"]["Enums"]["person_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          dept?: string | null
          email: string
          email_notifications?: boolean
          erp_user_id?: string | null
          full_name: string
          id?: string
          role?: Database["public"]["Enums"]["person_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          dept?: string | null
          email?: string
          email_notifications?: boolean
          erp_user_id?: string | null
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["person_role"]
          updated_at?: string
        }
        Relationships: []
      }
      phone_calls: {
        Row: {
          call_ended_at: string
          callyzer_call_id: string
          counterpart_masked: string
          counterpart_name: string | null
          created_at: string
          decision_reason: string | null
          decision_since: string | null
          direction: string
          first_claimed_at: string | null
          first_sheet_at: string | null
          line_id: string
          media_deleted_at: string | null
          meeting_id: string
          purged_at: string | null
          purged_by: string | null
          ready_at: string | null
          recording_bytes: number | null
          recording_duration_sec: number | null
          recording_mime: string | null
          recording_path: string | null
          recording_playable: boolean
          recording_seen_at: string | null
          recording_status: string
          seen_at: string
          skip_code: string | null
          speaker_count: number | null
          stored_at: string
          stt_attempts: number
          stt_audio_sec: number | null
          stt_error: string | null
          stt_error_kind: string | null
          stt_first_error_at: string | null
          stt_next_try_at: string | null
          stt_provider: string | null
          stt_started_at: string | null
          stt_status: string
          transcribed_at: string | null
          updated_at: string
        }
        Insert: {
          call_ended_at: string
          callyzer_call_id: string
          counterpart_masked: string
          counterpart_name?: string | null
          created_at?: string
          decision_reason?: string | null
          decision_since?: string | null
          direction: string
          first_claimed_at?: string | null
          first_sheet_at?: string | null
          line_id: string
          media_deleted_at?: string | null
          meeting_id: string
          purged_at?: string | null
          purged_by?: string | null
          ready_at?: string | null
          recording_bytes?: number | null
          recording_duration_sec?: number | null
          recording_mime?: string | null
          recording_path?: string | null
          recording_playable?: boolean
          recording_seen_at?: string | null
          recording_status?: string
          seen_at: string
          skip_code?: string | null
          speaker_count?: number | null
          stored_at?: string
          stt_attempts?: number
          stt_audio_sec?: number | null
          stt_error?: string | null
          stt_error_kind?: string | null
          stt_first_error_at?: string | null
          stt_next_try_at?: string | null
          stt_provider?: string | null
          stt_started_at?: string | null
          stt_status?: string
          transcribed_at?: string | null
          updated_at?: string
        }
        Update: {
          call_ended_at?: string
          callyzer_call_id?: string
          counterpart_masked?: string
          counterpart_name?: string | null
          created_at?: string
          decision_reason?: string | null
          decision_since?: string | null
          direction?: string
          first_claimed_at?: string | null
          first_sheet_at?: string | null
          line_id?: string
          media_deleted_at?: string | null
          meeting_id?: string
          purged_at?: string | null
          purged_by?: string | null
          ready_at?: string | null
          recording_bytes?: number | null
          recording_duration_sec?: number | null
          recording_mime?: string | null
          recording_path?: string | null
          recording_playable?: boolean
          recording_seen_at?: string | null
          recording_status?: string
          seen_at?: string
          skip_code?: string | null
          speaker_count?: number | null
          stored_at?: string
          stt_attempts?: number
          stt_audio_sec?: number | null
          stt_error?: string | null
          stt_error_kind?: string | null
          stt_first_error_at?: string | null
          stt_next_try_at?: string | null
          stt_provider?: string | null
          stt_started_at?: string | null
          stt_status?: string
          transcribed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_calls_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "phone_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_calls_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_line_members: {
        Row: {
          line_id: string
          person_id: string
        }
        Insert: {
          line_id: string
          person_id: string
        }
        Update: {
          line_id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_line_members_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "phone_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_line_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_lines: {
        Row: {
          analyse_from: string | null
          callyzer_name: string
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          first_seen_at: string
          id: string
          label: string | null
          last_call_at: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          analyse_from?: string | null
          callyzer_name: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          first_seen_at?: string
          id?: string
          label?: string | null
          last_call_at?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          analyse_from?: string | null
          callyzer_name?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          first_seen_at?: string
          id?: string
          label?: string | null
          last_call_at?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_lines_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_events: {
        Row: {
          created_at: string
          id: number
          level: string
          meeting_id: string | null
          message: string
          step: string
        }
        Insert: {
          created_at?: string
          id?: never
          level: string
          meeting_id?: string | null
          message: string
          step: string
        }
        Update: {
          created_at?: string
          id?: never
          level?: string
          meeting_id?: string | null
          message?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_events_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      sheets: {
        Row: {
          created_at: string
          headline: string
          id: string
          meeting_id: string
          model: string | null
          prompt_version: string
          result: Json
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          headline: string
          id?: string
          meeting_id: string
          model?: string | null
          prompt_version: string
          result: Json
          status?: string
          version: number
        }
        Update: {
          created_at?: string
          headline?: string
          id?: string
          meeting_id?: string
          model?: string | null
          prompt_version?: string
          result?: Json
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sheets_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_deletions: {
        Row: {
          created_at: string
          last_error: string | null
          last_tried_at: string | null
          path: string
          reason: string
        }
        Insert: {
          created_at?: string
          last_error?: string | null
          last_tried_at?: string | null
          path: string
          reason: string
        }
        Update: {
          created_at?: string
          last_error?: string | null
          last_tried_at?: string | null
          path?: string
          reason?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          key: string
          last_synced_at: string | null
          locked_until: string | null
          value: Json | null
        }
        Insert: {
          key: string
          last_synced_at?: string | null
          locked_until?: string | null
          value?: Json | null
        }
        Update: {
          key?: string
          last_synced_at?: string | null
          locked_until?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          fetched_at: string
          meeting_id: string
          sentence_count: number
          speaker_labels_reliable: boolean | null
          tldv_transcript_id: string | null
          turns: Json
          word_count: number
        }
        Insert: {
          fetched_at?: string
          meeting_id: string
          sentence_count?: number
          speaker_labels_reliable?: boolean | null
          tldv_transcript_id?: string | null
          turns: Json
          word_count?: number
        }
        Update: {
          fetched_at?: string
          meeting_id?: string
          sentence_count?: number
          speaker_labels_reliable?: boolean | null
          tldv_transcript_id?: string | null
          turns?: Json
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          event: string
          id: string
          received_at: string
          tldv_meeting_id: string | null
        }
        Insert: {
          event: string
          id: string
          received_at?: string
          tldv_meeting_id?: string | null
        }
        Update: {
          event?: string
          id?: string
          received_at?: string
          tldv_meeting_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_sales_meetings_ready: {
        Row: {
          happened_at: string | null
          title: string | null
          tldv_meeting_id: string | null
          tldv_url: string | null
          transcript_ready: boolean | null
          type_confidence: number | null
          type_source: Database["public"]["Enums"]["type_source"] | null
        }
        Insert: {
          happened_at?: string | null
          title?: string | null
          tldv_meeting_id?: string | null
          tldv_url?: string | null
          transcript_ready?: boolean | null
          type_confidence?: number | null
          type_source?: Database["public"]["Enums"]["type_source"] | null
        }
        Update: {
          happened_at?: string | null
          title?: string | null
          tldv_meeting_id?: string | null
          tldv_url?: string | null
          transcript_ready?: boolean | null
          type_confidence?: number | null
          type_source?: Database["public"]["Enums"]["type_source"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      call_ids_by_digits: {
        Args: { p_digits: string; p_limit?: number }
        Returns: {
          meeting_id: string
        }[]
      }
      calls_feed_status: { Args: never; Returns: Json }
      calls_nav: { Args: never; Returns: Json }
      claim_call_work: {
        Args: {
          p_cap_minutes: number
          p_max_attempts: number
          p_stale_minutes: number
          p_transcribe: boolean
        }
        Returns: {
          attempt: number
          callyzer_id: string
          duration_sec: number
          meeting_id: string
          recording_url: string
          storage_path: string
          work: string
        }[]
      }
      claim_next_meeting: { Args: { p_exclude?: string[] }; Returns: string }
      cleanup_call_log: { Args: { p_days?: number }; Returns: number }
      current_person_id: { Args: never; Returns: string }
      decide_call: {
        Args: {
          p_by_name: string
          p_client_id: string
          p_meeting_id: string
          p_type: Database["public"]["Enums"]["meeting_type"]
        }
        Returns: string
      }
      expire_call_audio: { Args: { p_days: number }; Returns: number }
      expire_call_recordings: { Args: { p_hours?: number }; Returns: number }
      expire_undecided_calls: {
        Args: {
          p_decision_hours: number
          p_failed_days: number
          p_max_days: number
        }
        Returns: number
      }
      finish_call_copy: {
        Args: {
          p_bytes?: number
          p_callyzer_id: string
          p_error?: string
          p_error_kind?: string
          p_max_attempts?: number
          p_outcome: string
        }
        Returns: string
      }
      finish_call_transcription: {
        Args: {
          p_error?: string
          p_error_kind?: string
          p_max_attempts?: number
          p_meeting_id: string
          p_outcome: string
        }
        Returns: string
      }
      hold_call: {
        Args: {
          p_claim: string
          p_confidence: number
          p_kind: string
          p_meeting_id: string
          p_reason: string
        }
        Returns: string
      }
      is_active_person: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      mark_call_business: {
        Args: {
          p_claim?: string
          p_client_id: string
          p_client_name_guess: string
          p_confidence: number
          p_meeting_id: string
          p_reason: string
          p_source: Database["public"]["Enums"]["type_source"]
          p_type: Database["public"]["Enums"]["meeting_type"]
        }
        Returns: string
      }
      previous_business_call: {
        Args: { p_meeting_id: string }
        Returns: {
          client: string
          type: Database["public"]["Enums"]["meeting_type"]
        }[]
      }
      promote_call: {
        Args: {
          p_bytes: number
          p_callyzer_id: string
          p_cap_minutes: number
          p_mime: string
          p_playable: boolean
          p_recording_path: string
          p_transcribe: boolean
        }
        Returns: {
          meeting_id: string
          outcome: string
        }[]
      }
      purge_call: {
        Args: {
          p_by: string
          p_code: string
          p_meeting_id: string
          p_reason: string
          p_summary?: string
        }
        Returns: string
      }
      purge_claimed_call: {
        Args: {
          p_claim: string
          p_code: string
          p_meeting_id: string
          p_reason: string
          p_summary?: string
        }
        Returns: string
      }
      register_phone_lines: {
        Args: { p_lines: Json }
        Returns: {
          callyzer_name: string
          created: boolean
          enabled: boolean
          line_id: string
          phone: string
        }[]
      }
      release_stale_call_claims: {
        Args: { p_max_attempts: number; p_minutes: number }
        Returns: number
      }
      release_stale_claims: {
        Args: { p_max_attempts: number; p_timeout_minutes: number }
        Returns: number
      }
      reserve_call_stt: {
        Args: {
          p_cap_minutes: number
          p_expected_sec: number
          p_meeting_id: string
        }
        Returns: boolean
      }
      retry_call_transcription: {
        Args: { p_meeting_id: string }
        Returns: boolean
      }
      save_call_sheet: {
        Args: {
          p_claim: string
          p_headline: string
          p_items: Json
          p_meeting_id: string
          p_model: string
          p_prompt_version: string
          p_result: Json
          p_reused: Json
          p_superseded: string[]
        }
        Returns: number
      }
      save_call_transcript: {
        Args: {
          p_audio_sec: number
          p_meeting_id: string
          p_min_words?: number
          p_provider: string
          p_sentences: number
          p_speakers: number
          p_turns: Json
          p_words: number
        }
        Returns: {
          purge_path: string
          status: string
        }[]
      }
      switch_line_off: {
        Args: { p_line_id: string }
        Returns: {
          dropped: number
          purged: number
        }[]
      }
      upsert_call_log: {
        Args: { p_rows: Json }
        Returns: {
          callyzer_id: string
          inserted: boolean
          status: string
        }[]
      }
    }
    Enums: {
      item_status: "open" | "in_progress" | "done" | "dropped" | "superseded"
      meeting_type:
        | "client"
        | "sales"
        | "internal"
        | "vendor"
        | "other"
        | "unknown"
      owner_side: "dny" | "client" | "both" | "unclear"
      person_role: "admin" | "member"
      priority: "high" | "medium" | "low"
      process_status:
        | "new"
        | "waiting_transcript"
        | "ready"
        | "processing"
        | "needs_decision"
        | "done"
        | "failed"
        | "skipped"
      sync_status: "not_applicable" | "pending" | "sent" | "failed"
      type_source: "rule" | "llm" | "human"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      item_status: ["open", "in_progress", "done", "dropped", "superseded"],
      meeting_type: [
        "client",
        "sales",
        "internal",
        "vendor",
        "other",
        "unknown",
      ],
      owner_side: ["dny", "client", "both", "unclear"],
      person_role: ["admin", "member"],
      priority: ["high", "medium", "low"],
      process_status: [
        "new",
        "waiting_transcript",
        "ready",
        "processing",
        "needs_decision",
        "done",
        "failed",
        "skipped",
      ],
      sync_status: ["not_applicable", "pending", "sent", "failed"],
      type_source: ["rule", "llm", "human"],
    },
  },
} as const
