package com.attenddesk.data.api

import kotlinx.serialization.Serializable

@Serializable
data class SetPasswordRequest(val newPassword: String)

@Serializable
data class MeResponse(
    val id: String,
    val email: String,
    val name: String,
    val role: String,
    val mustChangePassword: Boolean,
    val employeeId: String? = null,
    val designation: String? = null,
    val department: String? = null,
    val faceEnrolledAt: String? = null,
    val photoUrl: String? = null,
    val photoUpdatedAt: String? = null,
)

@Serializable
data class PhotoUploadResponse(val ok: Boolean, val photoUrl: String? = null)

@Serializable
data class PolicyDto(
    val requireWifi: Boolean,
    val requireGeo: Boolean,
    val requireQr: Boolean,
    val requireFace: Boolean,
    val faceThreshold: Double,
    val gpsAccuracyMaxMeters: Int,
)

@Serializable
data class OfficeDto(
    val id: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusMeters: Int,
    val allowedSsids: List<String>,
    val allowedBssids: List<String>,
)

@Serializable
data class VerifyFeaturesDto(
    val wifi: Boolean = true,
    val gps: Boolean = true,
    val qr: Boolean = true,
    val face: Boolean = true,
)

@Serializable
data class ServiceFeaturesDto(
    val kiosk: Boolean = true,
    val photos: Boolean = true,
    val faceEnrollment: Boolean = true,
    val history: Boolean = true,
    val leaveRequests: Boolean = true,
)

@Serializable
data class LocationFeatureDto(
    val mode: String = "manual", // "manual" | "geofence" | "periodic" | "continuous"
    val periodicIntervalMinutes: Int = 15,
    val continuousIntervalSeconds: Int = 60,
)

@Serializable
data class FeaturesDto(
    val verify: VerifyFeaturesDto = VerifyFeaturesDto(),
    val service: ServiceFeaturesDto = ServiceFeaturesDto(),
    val location: LocationFeatureDto = LocationFeatureDto(),
)

@Serializable
data class LocationPingRequest(
    val lat: Double,
    val lng: Double,
    val accuracy: Double,
    val capturedAt: String, // ISO-8601
    val source: String, // "periodic" | "continuous" | "geofence_enter" | "geofence_exit"
    val isMockLocation: Boolean? = null,
)

@Serializable
data class LocationPingResponse(val ok: Boolean = false)

@Serializable
data class PolicyResponse(
    val policy: PolicyDto?,
    val office: OfficeDto?,
    val features: FeaturesDto = FeaturesDto(),
    val faceEmbeddingDim: Int = 192,
    val faceEmbeddingModel: String = "mobilefacenet-v1",
)

@Serializable
data class HistoryEvent(
    val id: String,
    val type: String,
    val timestamp: String,
    val allChecksPassed: Boolean,
    val lat: Double? = null,
    val lng: Double? = null,
    val ssid: String? = null,
    val faceMatchScore: Double? = null,
    val isLate: Boolean = false,
    val isEarly: Boolean = false,
    val scheduledStart: String? = null,
    val scheduledEnd: String? = null,
)

@Serializable
data class HistoryResponse(val events: List<HistoryEvent>)

@Serializable
data class EnrollFaceRequest(val embeddings: List<String>)

@Serializable
data class CheckInRequest(
    val type: String, // "CHECK_IN" or "CHECK_OUT"
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyMeters: Double? = null,
    val isMockLocation: Boolean? = null,
    val ssid: String? = null,
    val bssid: String? = null,
    val qrToken: String? = null,
    val faceEmbeddingB64: String? = null,
    val faceLivenessOk: Boolean? = null,
)

@Serializable
data class CheckResultDto(
    val name: String,
    val required: Boolean,
    val passed: Boolean,
    val reason: String? = null,
)

@Serializable
data class CheckInResponse(
    val ok: Boolean,
    val eventId: String? = null,
    val results: List<CheckResultDto> = emptyList(),
    val faceMatchScore: Double? = null,
    val isLate: Boolean = false,
    val isEarly: Boolean = false,
    val scheduledStart: String? = null,
    val scheduledEnd: String? = null,
)

@Serializable
data class LeaveRequestDto(
    val id: String,
    val uid: String,
    val userEmail: String,
    val userName: String,
    val fromDay: String,
    val toDay: String,
    val totalDays: Int,
    val subject: String = "",
    val details: String = "",
    val status: String, // "pending" | "approved" | "rejected" | "cancelled"
    val createdAt: String? = null,
    val decidedAt: String? = null,
    val decidedBy: String? = null,
    val decisionNote: String? = null,
)

@Serializable
data class LeaveRequestListResponse(val requests: List<LeaveRequestDto> = emptyList())

@Serializable
data class LeaveRequestSubmitRequest(
    val fromDay: String,
    val toDay: String,
    val subject: String,
    val details: String,
)

@Serializable
data class LeaveRequestSubmitResponse(val id: String)

// ── Coming-soon modules ───────────────────────────────────────────────────────

@Serializable
data class IdResponse(val id: String)

@Serializable
data class DecisionRequest(val decision: String, val note: String? = null)

@Serializable
data class DecisionResponse(val ok: Boolean = true)

// Manage-list reuse: every list response carries an optional scope ("admin"|"lead").

// Leave (manage view reuses LeaveRequestDto). scope added to the existing list response.
@Serializable
data class LeaveManageResponse(val requests: List<LeaveRequestDto> = emptyList(), val scope: String? = null)

// Reconciliation
@Serializable
data class ReconDto(
    val id: String,
    val uid: String = "",
    val userEmail: String = "",
    val userName: String = "",
    val day: String = "",
    val proposedInIso: String? = null,
    val proposedOutIso: String? = null,
    val reason: String = "",
    val status: String = "pending",
    val createdAt: String? = null,
    val decidedAt: String? = null,
    val decidedBy: String? = null,
    val decisionNote: String? = null,
)

@Serializable
data class ReconSubmitRequest(
    val day: String,
    val proposedInIso: String? = null,
    val proposedOutIso: String? = null,
    val reason: String,
)

@Serializable
data class ReconListResponse(val requests: List<ReconDto> = emptyList(), val scope: String? = null)

// Remote attendance
@Serializable
data class RemoteDto(
    val id: String,
    val uid: String = "",
    val userEmail: String = "",
    val userName: String = "",
    val day: String = "",
    val reason: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    val place: String = "",
    val status: String = "pending",
    val createdAt: String? = null,
    val decidedAt: String? = null,
    val decidedBy: String? = null,
    val decisionNote: String? = null,
)

@Serializable
data class RemoteSubmitRequest(
    val day: String,
    val reason: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val place: String = "",
)

@Serializable
data class RemoteListResponse(val requests: List<RemoteDto> = emptyList(), val scope: String? = null)

// Assets
@Serializable
data class AssetRequestDto(
    val id: String,
    val uid: String = "",
    val userEmail: String = "",
    val userName: String = "",
    val assetName: String = "",
    val assetType: String = "",
    val description: String = "",
    val fromDay: String = "",
    val toDay: String = "",
    val totalDays: Int = 0,
    val requiresLead: Boolean = false,
    val status: String = "pending",
    val adminStatus: String = "pending",
    val leadStatus: String = "pending",
    val createdAt: String? = null,
)

@Serializable
data class AssetCreateRequest(
    val assetName: String,
    val assetType: String = "",
    val description: String = "",
    val fromDay: String,
    val toDay: String,
)

@Serializable
data class AssetListResponse(val requests: List<AssetRequestDto> = emptyList(), val scope: String? = null)

// Notice board
@Serializable
data class NoticeDto(
    val id: String,
    val title: String = "",
    val body: String = "",
    val pinned: Boolean = false,
    val createdAt: String? = null,
    val createdBy: String? = null,
)

@Serializable
data class NoticeListResponse(val notices: List<NoticeDto> = emptyList())

// Directory
@Serializable
data class DirectoryPersonDto(
    val uid: String,
    val name: String = "",
    val email: String = "",
    val role: String = "",
    val teamName: String? = null,
    val photoUrl: String? = null,
)

@Serializable
data class DirectoryResponse(val people: List<DirectoryPersonDto> = emptyList())

// Break time
@Serializable
data class BreakEventDto(val id: String, val type: String, val timestamp: String? = null)

@Serializable
data class BreaksResponse(val events: List<BreakEventDto> = emptyList(), val onBreak: Boolean = false)

@Serializable
data class BreakActionRequest(val action: String)

@Serializable
data class BreakRecordResponse(val id: String, val type: String)

// Team / subordinate weekly summary
@Serializable
data class TeamMemberSummaryDto(
    val uid: String,
    val name: String = "",
    val email: String = "",
    val onTime: Int = 0,
    val late: Int = 0,
    val absent: Int = 0,
    val todayIn: String? = null,
    val todayOut: String? = null,
)

@Serializable
data class TeamSummaryResponse(
    val isLeader: Boolean = false,
    val members: List<TeamMemberSummaryDto> = emptyList(),
    val scope: String? = null, // "admin" | "lead" (set by /manage/attendance)
)
