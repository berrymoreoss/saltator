// Differential: the flip-flop flavours of HDL-9 with their controls from pins and from logic —
// separate asynchronous set and reset, a reset made by logic, a latch. Not here, as unit tests:
// a control made from the flip-flop's own output (it loops Yosys's sim forever) and asynchronous
// loads ($aldff: while ALOAD is active Yosys's sim loads AD a step late, the interpreter — and
// the set/clear logic Yosys makes of it on a board — follows AD).
module flavours (
    input clk, input rst, input set, input en, input load, input g, input [3:0] d,
    output reg [3:0] q_sr, output reg [3:0] q_sre, output reg [3:0] q_arl = 4'd0,
    output reg [3:0] lat
);
  always @(posedge clk or posedge rst or posedge set)
    if (rst) q_sr <= 4'h0; else if (set) q_sr <= 4'hf; else q_sr <= d;
  always @(posedge clk or posedge rst or posedge set)
    if (rst) q_sre <= 4'h0; else if (set) q_sre <= 4'hf; else if (en) q_sre <= d;
  // A register cleared by logic.
  wire clear = set & load;
  always @(posedge clk or posedge clear) if (clear) q_arl <= 4'd0; else q_arl <= q_arl + d;
  always @* if (rst) lat = 4'h0; else if (g) lat = d;
endmodule
