package com.attenddesk.data.api

import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface AttendApi {
    @POST("auth/set-password")
    suspend fun setPassword(@Body body: SetPasswordRequest)

    @GET("me")
    suspend fun me(): MeResponse

    @GET("me/policy")
    suspend fun policy(): PolicyResponse

    @GET("me/history")
    suspend fun history(@Query("limit") limit: Int = 30): HistoryResponse

    @POST("me/enroll-face")
    suspend fun enrollFace(@Body body: EnrollFaceRequest)

    @POST("me/check-in")
    suspend fun checkIn(@Body body: CheckInRequest): CheckInResponse

    @Multipart
    @POST("me/photo")
    suspend fun uploadPhoto(@Part file: MultipartBody.Part): PhotoUploadResponse

    @DELETE("me/photo")
    suspend fun deletePhoto()

    @DELETE("me/data")
    suspend fun deleteData()

    @GET("me/leave-requests")
    suspend fun listMyLeaveRequests(): LeaveRequestListResponse

    @POST("me/leave-requests")
    suspend fun submitLeaveRequest(@Body body: LeaveRequestSubmitRequest): LeaveRequestSubmitResponse

    @DELETE("me/leave-requests/{id}")
    suspend fun cancelLeaveRequest(@Path("id") id: String)

    @POST("me/location-ping")
    suspend fun locationPing(@Body body: LocationPingRequest): LocationPingResponse

    // ── Coming-soon modules ──────────────────────────────────────────────────

    // Reconciliation
    @GET("me/recon") suspend fun listMyRecon(): ReconListResponse
    @POST("me/recon") suspend fun submitRecon(@Body body: ReconSubmitRequest): IdResponse
    @DELETE("me/recon/{id}") suspend fun cancelRecon(@Path("id") id: String)

    // Remote attendance
    @GET("me/remote") suspend fun listMyRemote(): RemoteListResponse
    @POST("me/remote") suspend fun submitRemote(@Body body: RemoteSubmitRequest): IdResponse
    @POST("me/remote/{id}") suspend fun doneRemote(@Path("id") id: String)
    @DELETE("me/remote/{id}") suspend fun cancelRemote(@Path("id") id: String)

    // Assets
    @GET("me/assets") suspend fun listMyAssets(): AssetListResponse
    @POST("me/assets") suspend fun createAsset(@Body body: AssetCreateRequest): IdResponse

    // Break time
    @POST("me/break") suspend fun recordBreak(@Body body: BreakActionRequest): BreakRecordResponse
    @GET("me/breaks") suspend fun listMyBreaks(): BreaksResponse

    // Directory / notices / team summary
    @GET("directory") suspend fun directory(): DirectoryResponse
    @GET("notices") suspend fun notices(): NoticeListResponse
    @GET("me/team-summary") suspend fun teamSummary(): TeamSummaryResponse

    // All-employees attendance roster (today in/out + 7-day counts). Any signed-in user.
    @GET("attendance") suspend fun viewAttendance(): TeamSummaryResponse

    // Manager approval queues
    @GET("manage/leave") suspend fun manageLeave(@Query("status") status: String? = "pending"): LeaveManageResponse
    @GET("manage/asset") suspend fun manageAsset(@Query("status") status: String? = "pending"): AssetListResponse
    @GET("manage/recon") suspend fun manageRecon(@Query("status") status: String? = "pending"): ReconListResponse
    @GET("manage/remote") suspend fun manageRemote(@Query("status") status: String? = "pending"): RemoteListResponse

    // Manager decisions
    @POST("manage/leave/{id}") suspend fun decideLeave(@Path("id") id: String, @Body body: DecisionRequest): DecisionResponse
    @POST("manage/asset/{id}") suspend fun decideAsset(@Path("id") id: String, @Body body: DecisionRequest): DecisionResponse
    @POST("manage/recon/{id}") suspend fun decideRecon(@Path("id") id: String, @Body body: DecisionRequest): DecisionResponse
    @POST("manage/remote/{id}") suspend fun decideRemote(@Path("id") id: String, @Body body: DecisionRequest): DecisionResponse
}
