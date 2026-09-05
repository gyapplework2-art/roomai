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
    PostgrestVersion: "14.5"
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
      design_objects: {
        Row: {
          category: string | null
          created_at: string
          depth_cm: number | null
          design_id: string
          height_cm: number | null
          id: string
          material: string | null
          name: string | null
          object_type: string
          primary_color: string | null
          product_id: string | null
          reasoning: string | null
          rotation_degrees: number
          width_cm: number | null
          x_cm: number | null
          y_cm: number | null
          z_cm: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          depth_cm?: number | null
          design_id: string
          height_cm?: number | null
          id?: string
          material?: string | null
          name?: string | null
          object_type: string
          primary_color?: string | null
          product_id?: string | null
          reasoning?: string | null
          rotation_degrees?: number
          width_cm?: number | null
          x_cm?: number | null
          y_cm?: number | null
          z_cm?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          depth_cm?: number | null
          design_id?: string
          height_cm?: number | null
          id?: string
          material?: string | null
          name?: string | null
          object_type?: string
          primary_color?: string | null
          product_id?: string | null
          reasoning?: string | null
          rotation_degrees?: number
          width_cm?: number | null
          x_cm?: number | null
          y_cm?: number | null
          z_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "design_objects_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "designs"
            referencedColumns: ["id"]
          },
        ]
      }
      designs: {
        Row: {
          created_at: string
          design_name: string | null
          design_specification: Json | null
          generation_completed_at: string | null
          generation_started_at: string | null
          id: string
          model_name: string | null
          model_provider: string | null
          project_id: string
          prompt_version: string | null
          status: string
          summary: string | null
          version: number
        }
        Insert: {
          created_at?: string
          design_name?: string | null
          design_specification?: Json | null
          generation_completed_at?: string | null
          generation_started_at?: string | null
          id?: string
          model_name?: string | null
          model_provider?: string | null
          project_id: string
          prompt_version?: string | null
          status?: string
          summary?: string | null
          version: number
        }
        Update: {
          created_at?: string
          design_name?: string | null
          design_specification?: Json | null
          generation_completed_at?: string | null
          generation_started_at?: string | null
          id?: string
          model_name?: string | null
          model_provider?: string | null
          project_id?: string
          prompt_version?: string | null
          status?: string
          summary?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "designs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          preferred_units: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          preferred_units?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_units?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          created_at: string
          currency: string
          height_cm: number | null
          id: string
          length_cm: number
          name: string
          room_type: string
          status: string
          updated_at: string
          user_id: string
          width_cm: number
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          currency?: string
          height_cm?: number | null
          id?: string
          length_cm: number
          name: string
          room_type: string
          status?: string
          updated_at?: string
          user_id: string
          width_cm: number
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          currency?: string
          height_cm?: number | null
          id?: string
          length_cm?: number
          name?: string
          room_type?: string
          status?: string
          updated_at?: string
          user_id?: string
          width_cm?: number
        }
        Relationships: []
      }
      room_preferences: {
        Row: {
          accent_color: string | null
          additional_notes: string | null
          avoid_materials: Json
          color_mood: string | null
          created_at: string
          household_size: string | null
          id: string
          metal_color: string | null
          must_have_items: Json
          nice_to_have_items: Json
          preferred_materials: Json
          primary_color: string | null
          primary_style: string | null
          priority: string | null
          project_id: string
          room_functions: Json
          secondary_color: string | null
          secondary_style: string | null
          special_requirements: Json
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          additional_notes?: string | null
          avoid_materials?: Json
          color_mood?: string | null
          created_at?: string
          household_size?: string | null
          id?: string
          metal_color?: string | null
          must_have_items?: Json
          nice_to_have_items?: Json
          preferred_materials?: Json
          primary_color?: string | null
          primary_style?: string | null
          priority?: string | null
          project_id: string
          room_functions?: Json
          secondary_color?: string | null
          secondary_style?: string | null
          special_requirements?: Json
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          additional_notes?: string | null
          avoid_materials?: Json
          color_mood?: string | null
          created_at?: string
          household_size?: string | null
          id?: string
          metal_color?: string | null
          must_have_items?: Json
          nice_to_have_items?: Json
          preferred_materials?: Json
          primary_color?: string | null
          primary_style?: string | null
          priority?: string | null
          project_id?: string
          room_functions?: Json
          secondary_color?: string | null
          secondary_style?: string | null
          special_requirements?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_preferences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
